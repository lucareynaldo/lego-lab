// Arma el manual en HTML (páginas A4 apaisadas) a partir del plan y las imágenes renderizadas,
// y lo imprime a PDF con Edge o Chrome headless.
//
// Estructura de carpetas esperada en <carpeta>:
//   plan.json
//   sNN/element-K.png   paso K+1 de la sección NN (y element-<pasos>.png: la sección terminada)
//   dNN/element-K.png   recuadro ampliado del paso K+1 (solo los pasos con detalle)
//   piezas/element-I.png  pieza I del inventario

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {PasoPlan, Plan, Seccion} from './planificar.ts';

const PASOS_POR_PAGINA = 4;
const PIEZAS_POR_PAGINA = 32; // 4 filas de 8
const LISTA_LARGA = 8; // con más tipos de pieza, la lista va a lo ancho y con imágenes más chicas

export type OpcionesManual = {
	usoInterno?: boolean; // sets oficiales: se marca que no es para distribuir
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
const nn = (n: number) => String(n).padStart(2, '0');
const imgPaso = (s: Seccion, paso: number) => `s${nn(s.numero)}/element-${paso - 1}.png`;
const imgDetalle = (s: Seccion, paso: number) => `d${nn(s.numero)}/element-${paso - 1}.png`;
// Imagen de la sección terminada, sin resaltar (el fotograma extra que sigue al último paso).
const imgTerminada = (s: Seccion) => `s${nn(s.numero)}/element-${s.pasos.length}.png`;
// Los nombres internos de los archivos ("Step 5", "Steps 24 to 31", "Truck S31") no le dicen nada a
// quien arma: se muestra solo el número de sección.
const tituloVisible = (s: Seccion) => (/\bsteps?\b|\bs\d+\b|^(sub|part|model)\s*\d*$/i.test(s.titulo) ? '' : s.titulo);

// Qué comprueba cada regla del verificador, para la página de verificación.
const REGLAS: Record<string, string> = {
	'pieza-inexistente': 'Pieza que no existe en la biblioteca LDraw',
	'color-inexistente': 'Color que no existe',
	'pieza-no-oficial': 'Pieza no oficial o personalizada',
	'pieza-renombrada': 'Pieza con número viejo (renombrada)',
	'combinacion-no-vista': 'Pieza + color que no aparece en ningún set',
	colision: 'Piezas que se atraviesan',
	superpuestas: 'Piezas que ocupan el mismo lugar',
	roce: 'Solape menor a 1 mm (imprecisión del modelo)',
	engranaje: 'Solape de engranajes u orugas (normal)',
	flotante: 'Piezas en el aire durante un paso',
	'sostener-un-paso': 'Piezas que hay que sostener hasta el paso siguiente',
	'suelto-varios-pasos': 'Piezas que recién se unen al resto varios pasos después',
	'flotante-sin-datos': 'Piezas sin datos de conexión, sueltas en un paso',
	'giro-con-piezas-sueltas': 'Se da vuelta el modelo con piezas sueltas',
	'subarmado-en-varias-partes': 'Sub-armado que se desarma al levantarlo',
	'submodelo-de-objetos-sueltos': 'Grupo de objetos sueltos',
	'modelo-en-varias-partes': 'El modelo son varios objetos separados',
	flota: 'Piezas que flotan en el modelo terminado',
	'apoyado-sin-conexion': 'Carga suelta apoyada sin encastrar',
	'mal-nivelado': 'Objeto aparte un poco por encima de la mesa',
	'sin-camino-recto': 'Pieza que no puede entrar en línea recta',
	'orden-sin-camino': 'Pieza que no entra en el orden de los pasos (sí en otro orden)',
	'requiere-subarmado': 'Piezas que hay que armar aparte y colocar juntas',
	'camino-dudoso': 'Entrada no verificable (clips, bisagras)',
	'se-vuelca': 'El modelo terminado se vuelca',
	'queda-inclinado': 'El modelo terminado queda inclinado',
};

export function maquetar(carpeta: string, opciones: OpcionesManual = {}): string {
	const plan: Plan = JSON.parse(readFileSync(join(carpeta, 'plan.json'), 'utf8'));
	const indicePieza = new Map(plan.inventario.map((x, i) => [`${x.archivo}|${x.color}`, i]));
	const imgPieza = (archivo: string, color: number) => `piezas/element-${indicePieza.get(`${archivo}|${color}`) ?? 0}.png`;
	const seccionPorId = new Map(plan.secciones.map((s) => [s.id, s]));

	// Numeración de páginas: portada, pasos de cada sección, inventario, verificación.
	const paginas: string[] = [];
	const paginaDeSeccion = new Map<string, number>();
	let pagina = 2;
	for (const s of plan.secciones) {
		paginaDeSeccion.set(s.id, pagina);
		pagina += Math.ceil(s.pasos.length / PASOS_POR_PAGINA);
	}

	const pie = (n: number) =>
		`<footer><span>${opciones.usoInterno ? 'Uso interno de prueba · no distribuir' : 'Instrucciones no oficiales'}</span><span>${n}</span></footer>`;

	// Portada
	const ultima = plan.secciones.at(-1)!;
	paginas.push(`<section class="pagina portada">
		<div class="titulo">
			<h1>${esc(plan.titulo)}</h1>
			<p class="datos">${plan.piezasTotales} piezas · ${plan.pasosTotales} pasos${plan.secciones.length > 1 ? ` · ${plan.secciones.length} secciones` : ''}</p>
		</div>
		<img class="final" src="${imgTerminada(ultima)}">
		<p class="legal">Instrucciones generadas automáticamente por lego-lab a partir de un modelo LDraw.
		LEGO® es una marca registrada del Grupo LEGO, que no patrocina, autoriza ni respalda este documento.
		${opciones.usoInterno ? '<br><strong>Uso interno de prueba: el diseño del set pertenece al Grupo LEGO. No distribuir.</strong>' : ''}</p>
		${pie(1)}
	</section>`);

	// Pasos
	for (const s of plan.secciones) {
		const esPrincipal = s === ultima;
		for (let i = 0; i < s.pasos.length; i += PASOS_POR_PAGINA) {
			const grupo = s.pasos.slice(i, i + PASOS_POR_PAGINA);
			const n = paginaDeSeccion.get(s.id)! + i / PASOS_POR_PAGINA;
			paginas.push(`<section class="pagina pasos n${grupo.length}">
				${esPrincipal ? '' : `<div class="insignia"><b>${s.numero}</b> ${esc(tituloVisible(s) || 'Sub-armado')}${s.usos > 1 ? ` <i>×${s.usos}</i>` : ''}</div>`}
				${grupo.map((p) => celdaPaso(s, p)).join('')}
				${pie(n)}
			</section>`);
		}
	}

	function celdaPaso(s: Seccion, p: PasoPlan) {
		const piezas = p.piezas
			.map((x) => `<figure><img src="${imgPieza(x.archivo, x.color)}"><figcaption>${x.cantidad}x</figcaption></figure>`)
			.join('');
		const subarmados = p.subarmados
			.map(({seccion, cantidad}) => {
				const sub = seccionPorId.get(seccion)!;
				return `<figure class="sub"><img src="${imgTerminada(sub)}"><figcaption>${cantidad}x
					<span class="ref"><b>${sub.numero}</b> pág. ${paginaDeSeccion.get(seccion)}</span></figcaption></figure>`;
			})
			.join('');
		const larga = p.piezas.length + p.subarmados.length > LISTA_LARGA;
		const lista = piezas || subarmados ? `<div class="lista${larga ? ' larga' : ''}">${subarmados}${piezas}</div>` : '';
		const detalle = p.detalle ? `<img class="detalle" src="${imgDetalle(s, p.numero)}">` : '';
		return `<article class="paso">
			<div class="cabecera">${lista}<div class="numero">${p.numero}</div></div>
			<div class="imagen"><img class="vista" src="${imgPaso(s, p.numero)}">${detalle}</div>
		</article>`;
	}

	// Inventario
	for (let i = 0; i < plan.inventario.length; i += PIEZAS_POR_PAGINA) {
		const grupo = plan.inventario.slice(i, i + PIEZAS_POR_PAGINA);
		paginas.push(`<section class="pagina inventario">
			<h2>Piezas${i === 0 ? ` <small>${plan.piezasTotales} piezas en ${plan.inventario.length} combinaciones de pieza y color</small>` : ''}</h2>
			<div class="grilla">
			${grupo
				.map(
					(x) => `<figure>
				<img src="piezas/element-${indicePieza.get(`${x.archivo}|${x.color}`)}.png">
				<figcaption><b>${x.cantidad}x</b> ${x.elemento ? `<span class="elemento">${x.elemento}</span>` : ''}
				<span class="color"><i style="background:#${x.rgb}"></i>${esc(x.colorNombre)}</span>
				<span class="pieza">${esc(x.archivo.replace(/\.dat$/, ''))}</span></figcaption>
			</figure>`,
				)
				.join('')}
			</div>
			${pie(pagina++)}
		</section>`);
	}

	// Verificación
	const v = plan.verificacion;
	const filas = Object.entries(v.porRegla)
		.sort(([, a], [, b]) => (a.severidad === b.severidad ? b.cantidad - a.cantidad : a.severidad === 'error' ? -1 : 1))
		.map(
			([regla, x]) => `<tr class="${x.severidad}"><td>${x.severidad === 'error' ? '✗' : '·'}</td><td>${esc(REGLAS[regla] ?? regla)}</td>
			<td class="n">${x.cantidad}</td><td class="ej">${esc(x.ejemplo)}</td></tr>`,
		)
		.join('');
	paginas.push(`<section class="pagina verificacion">
		<h2>Verificación por computadora</h2>
		<p class="resumen ${v.errores === 0 ? 'ok' : 'mal'}">${v.errores === 0 ? '✓ Sin errores' : `✗ ${v.errores} error${v.errores > 1 ? 'es' : ''}`}
			<span>${v.avisos} aviso${v.avisos === 1 ? '' : 's'} · ${plan.piezasTotales} piezas · ${v.conexiones} conexiones · ~${v.masaG} g estimados</span></p>
		<p>Se comprobó, pieza por pieza y paso a paso: que cada pieza exista y en un color real; que esté conectada;
		que ningún paso deje piezas en el aire; que cada pieza pueda entrar en su lugar en línea recta; que nada se
		atraviese; y que el modelo terminado se sostenga sobre su base.</p>
		${filas ? `<table><thead><tr><th></th><th>Hallazgo</th><th>Casos</th><th>Ejemplo</th></tr></thead><tbody>${filas}</tbody></table>` : ''}
		<p class="nota"><b>No probado físicamente.</b> La verificación es por computadora: no mide cuánto aprietan las uniones,
		las tolerancias de las piezas reales ni la resistencia al manipular el modelo.</p>
		${pie(pagina++)}
	</section>`);

	const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(plan.titulo)}</title>
<style>
	@page { size: A4 landscape; margin: 0; }
	* { box-sizing: border-box; }
	body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #1d2733; }
	.pagina { width: 297mm; height: 210mm; position: relative; overflow: hidden; page-break-after: always; padding: 10mm 12mm 14mm; }
	footer { position: absolute; left: 12mm; right: 12mm; bottom: 6mm; display: flex; justify-content: space-between; font-size: 9pt; color: #7a8591; }
	footer span:last-child { font-size: 13pt; font-weight: 700; color: #1d2733; }

	.portada { display: flex; flex-direction: column; align-items: center; background: linear-gradient(#f7f3ea, #e9e1d0); }
	.portada .titulo { text-align: center; }
	.portada h1 { font-size: 34pt; margin: 4mm 0 1mm; }
	.portada .datos { font-size: 14pt; margin: 0; color: #4a5561; }
	.portada .final { flex: 1; min-height: 0; max-width: 100%; object-fit: contain; mix-blend-mode: multiply; }
	.portada .legal { font-size: 8.5pt; color: #6a7480; text-align: center; max-width: 200mm; margin: 0 0 4mm; }

	.pasos { display: grid; gap: 5mm 8mm; }
	.pasos.n4, .pasos.n3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
	.pasos.n2 { grid-template-columns: 1fr 1fr; }
	.pasos.n1 { grid-template-columns: 1fr; }
	.insignia { position: absolute; top: 4mm; right: 12mm; background: #ffd23f; border-radius: 4mm; padding: 1mm 4mm; font-size: 10pt; z-index: 2; }
	.insignia b { background: #1d2733; color: #fff; border-radius: 50%; display: inline-block; width: 6mm; height: 6mm; text-align: center; line-height: 6mm; margin-right: 1mm; }
	.paso { position: relative; display: flex; flex-direction: column; min-height: 0; border-bottom: 0.3mm solid #e3e7eb; }
	.cabecera { display: flex; align-items: flex-start; gap: 3mm; }
	.numero { font-size: 26pt; font-weight: 800; line-height: 1; }
	.lista { order: -1; display: flex; flex-wrap: wrap; gap: 1mm 3mm; background: #dcebf7; border: 0.3mm solid #b7d2ea; border-radius: 2mm; padding: 1.5mm 2.5mm; max-width: 75%; }
	.lista figure { margin: 0; text-align: center; }
	.lista img { height: 14mm; mix-blend-mode: multiply; display: block; }
	.lista figcaption { font-size: 8.5pt; font-weight: 600; }
	.lista.larga { max-width: 88%; gap: 0.5mm 2mm; }
	.lista.larga img { height: 9mm; }
	.lista.larga figcaption { font-size: 7.5pt; }
	.lista .sub img { height: 18mm; border: 0.3mm solid #ffd23f; border-radius: 1.5mm; background: #fff; }
	.lista .ref { display: block; font-weight: 400; font-size: 7.5pt; }
	.lista .ref b { background: #ffd23f; border-radius: 1mm; padding: 0 1mm; }
	.imagen { flex: 1; min-height: 0; position: relative; }
	.vista { width: 100%; height: 100%; object-fit: contain; }
	.detalle { position: absolute; right: 0; bottom: 1mm; width: 32%; aspect-ratio: 1; object-fit: cover; background: #fff;
		border: 0.6mm solid #ff9f1a; border-radius: 3mm; box-shadow: 0 0.5mm 2mm #0002; }

	.inventario h2, .verificacion h2 { margin: 0 0 4mm; font-size: 18pt; }
	.inventario h2 small { font-size: 10pt; font-weight: 400; color: #6a7480; margin-left: 3mm; }
	.grilla { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3mm; }
	.grilla figure { margin: 0; font-size: 7.5pt; text-align: center; }
	.grilla img { width: 100%; height: 18mm; object-fit: contain; mix-blend-mode: multiply; }
	.grilla figcaption span { display: block; color: #4a5561; }
	.grilla .elemento { font-weight: 700; color: #1d2733; }
	.grilla .color i { display: inline-block; width: 2.5mm; height: 2.5mm; border-radius: 0.5mm; margin-right: 1mm; vertical-align: -0.3mm; border: 0.2mm solid #0003; }

	.verificacion { font-size: 10pt; }
	.verificacion .resumen { font-size: 16pt; font-weight: 700; margin: 0 0 3mm; }
	.verificacion .resumen span { font-size: 10pt; font-weight: 400; color: #4a5561; margin-left: 4mm; }
	.verificacion .ok { color: #1e8a3c; }
	.verificacion .mal { color: #c0232c; }
	.verificacion table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 3mm 0; }
	.verificacion th { text-align: left; border-bottom: 0.4mm solid #1d2733; padding: 1mm; }
	.verificacion td { border-bottom: 0.2mm solid #e3e7eb; padding: 1mm; vertical-align: top; }
	.verificacion tr.error td:first-child { color: #c0232c; font-weight: 700; }
	.verificacion td.n { text-align: right; width: 12mm; }
	.verificacion td.ej { color: #6a7480; }
	.verificacion .nota { color: #4a5561; }
</style></head><body>
${paginas.join('\n')}
</body></html>`;
	const rutaHtml = join(carpeta, 'manual.html');
	writeFileSync(rutaHtml, html);
	return rutaHtml;
}

// Imprime el HTML a PDF con el navegador del sistema (Edge viene con Windows).
export function imprimirPdf(rutaHtml: string, rutaPdf: string) {
	const candidatos = [
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
	];
	const navegador = candidatos.find(existsSync);
	if (!navegador) throw new Error('No encontré Edge ni Chrome para imprimir el PDF');
	// El navegador escribe ruido de diagnóstico en stderr: se descarta.
	execFileSync(
		navegador,
		['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${resolve(rutaPdf)}`, pathToFileURL(resolve(rutaHtml)).href],
		{stdio: 'ignore'},
	);
}
