/**
 * Sustituto de `server-only` para los tests.
 *
 * El paquete real no tiene punto de entrada resoluble en Node: existe
 * para que el empaquetador falle si un módulo de servidor acaba en el
 * bundle del cliente. En Vitest ese riesgo no aplica, y el guardia sigue
 * intacto donde importa, que es la compilación de producción.
 */
export {};
