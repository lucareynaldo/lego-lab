export type Comparacion = {i: number; j: number; resultado: 'i' | 'j' | 'empate'};

export const SIGMA_PRIOR = 3;

const LAMBDA_MIN = Math.log(1e-6);
const LAMBDA_MAX = Math.log(1e6);

type Punto = {theta: number[]; lambda: number};

// Log-verosimilitud penalizada por un prior gaussiano N(0, σ²) sobre θ.
function objetivo(n: number, comps: Comparacion[], p: Punto, sigma: number): number {
	const nu = Math.exp(p.lambda);
	let f = 0;
	for (const c of comps) {
		const ti = p.theta[c.i]!;
		const tj = p.theta[c.j]!;
		const t = nu * Math.sqrt(Math.exp(ti + tj));
		const logD = Math.log(Math.exp(ti) + Math.exp(tj) + t);
		f += (c.resultado === 'i' ? ti : c.resultado === 'j' ? tj : p.lambda + (ti + tj) / 2) - logD;
	}
	for (let a = 0; a < n; a++) f -= p.theta[a]! ** 2 / (2 * sigma * sigma);
	return f;
}

// Resuelve A x = b por eliminación gaussiana con pivoteo parcial.
function resolver(A: number[][], b: number[]): number[] {
	const k = b.length;
	const M = A.map((fila, r) => [...fila, b[r]!]);
	for (let c = 0; c < k; c++) {
		let piv = c;
		for (let r = c + 1; r < k; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
		[M[c], M[piv]] = [M[piv]!, M[c]!];
		for (let r = c + 1; r < k; r++) {
			const f = M[r]![c]! / M[c]![c]!;
			for (let q = c; q <= k; q++) M[r]![q]! -= f * M[c]![q]!;
		}
	}
	const x = new Array<number>(k).fill(0);
	for (let r = k - 1; r >= 0; r--) {
		let s = M[r]![k]!;
		for (let q = r + 1; q < k; q++) s -= M[r]![q]! * x[q]!;
		x[r] = s / M[r]![r]!;
	}
	return x;
}

// Newton amortiguado (la penalizada es estrictamente cóncava en θ) hasta max|Δ| < 1e-6.
function ajustarPenalizado(n: number, comps: Comparacion[], iter: number, sigma: number, inicio?: Punto): Punto {
	let p: Punto = inicio
		? {theta: [...inicio.theta], lambda: inicio.lambda}
		: {theta: new Array<number>(n).fill(0), lambda: Math.log(0.5)};
	const k = n + 1;
	let f = objetivo(n, comps, p, sigma);
	for (let it = 0; it < iter; it++) {
		const nu = Math.exp(p.lambda);
		const g = new Array<number>(k).fill(0);
		const H = Array.from({length: k}, () => new Array<number>(k).fill(0));
		for (const c of comps) {
			const pi = Math.exp(p.theta[c.i]!);
			const pj = Math.exp(p.theta[c.j]!);
			const t = nu * Math.sqrt(pi * pj);
			const d = pi + pj + t;
			const w = [pi / d, pj / d, t / d];
			// log D es log-sum-exp de tres formas lineales: e_i, e_j y (e_i+e_j)/2+e_λ.
			const feats: [number, number][][] = [[[c.i, 1]], [[c.j, 1]], [[c.i, 0.5], [c.j, 0.5], [n, 1]]];
			const media = new Array<number>(k).fill(0);
			for (let q = 0; q < 3; q++) for (const [idx, v] of feats[q]!) media[idx]! += w[q]! * v;
			for (let q = 0; q < 3; q++) {
				const fq = new Array<number>(k).fill(0);
				for (const [idx, v] of feats[q]!) fq[idx]! += v;
				for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) H[a]![b]! += w[q]! * fq[a]! * fq[b]!;
			}
			for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) H[a]![b]! -= media[a]! * media[b]!;
			for (let a = 0; a < k; a++) g[a]! -= media[a]!;
			if (c.resultado === 'i') g[c.i]! += 1;
			else if (c.resultado === 'j') g[c.j]! += 1;
			else {
				g[c.i]! += 0.5;
				g[c.j]! += 0.5;
				g[n]! += 1;
			}
		}
		for (let a = 0; a < n; a++) {
			g[a]! -= p.theta[a]! / (sigma * sigma);
			H[a]![a]! += 1 / (sigma * sigma);
		}
		for (let a = 0; a < k; a++) H[a]![a]! += 1e-9;
		const paso = resolver(H, g);
		let escala = 1;
		let siguiente = p;
		let fs = f;
		for (let r = 0; r < 40; r++) {
			const theta = p.theta.map((x, a) => x + escala * paso[a]!);
			const lambda = Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, p.lambda + escala * paso[n]!));
			siguiente = {theta, lambda};
			fs = objetivo(n, comps, siguiente, sigma);
			if (fs >= f - 1e-12) break;
			escala /= 2;
		}
		const acepta = fs >= f - 1e-12;
		let delta = 0;
		if (acepta) {
			delta = Math.abs(siguiente.lambda - p.lambda);
			for (let a = 0; a < n; a++) delta = Math.max(delta, Math.abs(siguiente.theta[a]! - p.theta[a]!));
			p = siguiente;
			f = Math.max(f, fs);
		}
		if (delta < 1e-6) break;
	}
	const media = p.theta.reduce((s, x) => s + x, 0) / n;
	return {theta: p.theta.map(x => x - media), lambda: p.lambda};
}

// Bradley–Terry con empates (Davidson 1970), MAP con prior gaussiano débil sobre θ (σ = SIGMA_PRIOR):
// evita que la separación completa mande θ a infinito. `iter` es solo un tope; corta por tolerancia.
export function ajustarBT(
	n: number,
	comps: Comparacion[],
	iter = 4000,
	sigma = SIGMA_PRIOR,
	inicio?: {theta: number[]; nu: number},
): {theta: number[]; nu: number} {
	const {theta, lambda} = ajustarPenalizado(
		n,
		comps,
		iter,
		sigma,
		inicio && {theta: inicio.theta, lambda: Math.log(inicio.nu)},
	);
	return {theta, nu: Math.exp(lambda)};
}

function cuantil(ordenado: number[], q: number): number {
	if (ordenado.length === 0) return NaN;
	const pos = q * (ordenado.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return ordenado[lo]! + (ordenado[hi]! - ordenado[lo]!) * (pos - lo);
}

// Remuestrea comparaciones con reposición. Cada réplica arranca del ajuste completo (mismo óptimo, menos iteraciones).
export function bootstrapBT(
	n: number,
	comps: Comparacion[],
	reps = 2000,
	azar: () => number,
	sigma = SIGMA_PRIOR,
): {theta: number[]; ic: [number, number][]; pSuperior: number[][]} {
	const base = ajustarBT(n, comps, 4000, sigma);
	const muestras: number[][] = [];
	const pSuperior = Array.from({length: n}, () => new Array<number>(n).fill(0));
	for (let r = 0; r < reps; r++) {
		const rem = Array.from({length: comps.length}, () => comps[Math.floor(azar() * comps.length)]!);
		const {theta} = ajustarBT(n, rem, 200, sigma, base);
		muestras.push(theta);
		for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (theta[a]! > theta[b]!) pSuperior[a]![b]! += 1 / reps;
	}
	const ic = Array.from({length: n}, (_, a): [number, number] => {
		const xs = muestras.map(m => m[a]!).sort((x, y) => x - y);
		return [cuantil(xs, 0.025), cuantil(xs, 0.975)];
	});
	return {theta: base.theta, ic, pSuperior};
}

export function bootstrapMedia(xs: number[], reps = 10000, azar: () => number): {media: number; ic: [number, number]} {
	if (xs.length === 0) return {media: NaN, ic: [NaN, NaN]};
	const media = xs.reduce((s, x) => s + x, 0) / xs.length;
	const medias: number[] = [];
	for (let r = 0; r < reps; r++) {
		let s = 0;
		for (let k = 0; k < xs.length; k++) s += xs[Math.floor(azar() * xs.length)]!;
		medias.push(s / xs.length);
	}
	medias.sort((a, b) => a - b);
	return {media, ic: [cuantil(medias, 0.025), cuantil(medias, 0.975)]};
}

// Intervalo de Wilson al 95 %.
export function wilson(k: number, n: number): [number, number] {
	if (n === 0) return [0, 1];
	const z = 1.959964;
	const p = k / n;
	const z2 = z * z;
	const centro = (p + z2 / (2 * n)) / (1 + z2 / n);
	const mitad = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
	return [Math.max(0, centro - mitad), Math.min(1, centro + mitad)];
}

// Kappa de Cohen entre dos listas de etiquetas categóricas.
export function kappa(a: string[], b: string[]): number {
	if (a.length !== b.length) throw new Error('kappa: las listas deben tener el mismo largo');
	const n = a.length;
	if (n === 0) return NaN;
	const ca = new Map<string, number>();
	const cb = new Map<string, number>();
	let coinciden = 0;
	for (let i = 0; i < n; i++) {
		ca.set(a[i]!, (ca.get(a[i]!) ?? 0) + 1);
		cb.set(b[i]!, (cb.get(b[i]!) ?? 0) + 1);
		if (a[i] === b[i]) coinciden++;
	}
	const po = coinciden / n;
	let pe = 0;
	for (const [e, x] of ca) pe += (x / n) * ((cb.get(e) ?? 0) / n);
	// Si el acuerdo esperado es 1, ambos usan una única etiqueta idéntica: acuerdo total.
	return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

// Tau-b de Kendall: corrige empates en x o en y. NaN si alguna serie es constante.
export function kendallTau(x: number[], y: number[]): number {
	if (x.length !== y.length) throw new Error('kendallTau: las series deben tener el mismo largo');
	let conc = 0;
	let disc = 0;
	let tx = 0;
	let ty = 0;
	for (let i = 0; i < x.length; i++) {
		for (let j = i + 1; j < x.length; j++) {
			const dx = Math.sign(x[i]! - x[j]!);
			const dy = Math.sign(y[i]! - y[j]!);
			if (dx === 0 && dy === 0) continue;
			if (dx === 0) ty++;
			else if (dy === 0) tx++;
			else if (dx === dy) conc++;
			else disc++;
		}
	}
	return (conc - disc) / Math.sqrt((conc + disc + tx) * (conc + disc + ty));
}
