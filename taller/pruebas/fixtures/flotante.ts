import {Modelo} from '../../src/dsl.ts';

const m = new Modelo('flotante');
m.raiz.poner('3001', 'Red');
m.raiz.paso();
m.raiz.poner('3001', 'Blue', {en: [200, -200, 0], nombre: 'en-el-aire'});
m.raiz.paso();
m.guardar();
