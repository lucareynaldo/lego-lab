import {Modelo} from '../../src/dsl.ts';

const m = new Modelo('Dos Ladrillos');
const pila = m.sub('pila');
const a = pila.poner('3001', 'Red', {nombre: 'abajo'});
pila.paso();
pila.poner('3001', 'white', {sobre: a, stud: [2, 0], nombre: 'arriba'});
pila.paso();
m.raiz.colocar(pila);
m.raiz.paso();
m.guardar();
