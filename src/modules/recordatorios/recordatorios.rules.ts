export type EstadoRecordatorio = "PENDIENTE" | "COMPLETADO" | "CANCELADO";

type EntradaVencimiento = {
  estado: EstadoRecordatorio;
  // YYYY-MM-DD, o null si el recordatorio es solo por kilometraje.
  fechaObjetivo: string | null;
  kilometrajeObjetivo: number | null;
  // Ultimo kilometraje registrado de la moto (se actualiza con cada orden de servicio).
  kilometrajeActual: number | null;
  // YYYY-MM-DD en hora de Colombia.
  hoy: string;
};

// "Vencido" = pendiente cuya fecha ya llego o cuyo kilometraje ya se alcanzo.
// Un recordatorio completado o cancelado nunca esta vencido.
export const evaluarVencimiento = (entrada: EntradaVencimiento) => {
  if (entrada.estado !== "PENDIENTE") {
    return { vencidoPorFecha: false, vencidoPorKm: false, vencido: false };
  }

  const vencidoPorFecha = entrada.fechaObjetivo !== null && entrada.fechaObjetivo <= entrada.hoy;
  const vencidoPorKm =
    entrada.kilometrajeObjetivo !== null &&
    entrada.kilometrajeActual !== null &&
    entrada.kilometrajeActual >= entrada.kilometrajeObjetivo;

  return { vencidoPorFecha, vencidoPorKm, vencido: vencidoPorFecha || vencidoPorKm };
};

export const tieneObjetivo = (objetivo: { fechaObjetivo?: string | null; kilometrajeObjetivo?: number | null }) =>
  Boolean(objetivo.fechaObjetivo) || (objetivo.kilometrajeObjetivo !== undefined && objetivo.kilometrajeObjetivo !== null);

export const asuntoCorreo = (taller: string) => `Recordatorio de mantenimiento - ${taller}`;

export const textoCorreo = (datos: {
  cliente: string;
  taller: string;
  placa: string;
  tipoMantenimiento: string;
  fechaObjetivo: string | null;
  kilometrajeObjetivo: number | null;
}) => {
  const cuando = [
    datos.fechaObjetivo ? `la fecha ${datos.fechaObjetivo}` : null,
    datos.kilometrajeObjetivo === null ? null : `los ${datos.kilometrajeObjetivo.toLocaleString("es-CO")} km`,
  ]
    .filter(Boolean)
    .join(" o ");

  return [
    `Hola ${datos.cliente},`,
    "",
    `Te recordamos que tu motocicleta ${datos.placa} tiene programado el servicio "${datos.tipoMantenimiento}" para ${cuando}.`,
    "",
    `Comunicate con ${datos.taller} para agendar tu visita.`,
  ].join("\n");
};
