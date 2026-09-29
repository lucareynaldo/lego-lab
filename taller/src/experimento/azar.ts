export function mulberry32(semilla: number): () => number {
	let t = semilla >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = Math.imul(t ^ (t >>> 15), t | 1);
		r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

export function mezclar<T>(xs: T[], azar: () => number): T[] {
	const r = [...xs];
	for (let i = r.length - 1; i > 0; i--) {
		const j = Math.floor(azar() * (i + 1));
		[r[i], r[j]] = [r[j]!, r[i]!];
	}
	return r;
}

export function idsAnonimos(n: number, azar: () => number): string[] {
	const usados = new Set<string>();
	while (usados.size < n) {
		let id = '';
		for (let i = 0; i < 4; i++) id += String.fromCharCode(65 + Math.floor(azar() * 26));
		usados.add(id);
	}
	return [...usados];
}
