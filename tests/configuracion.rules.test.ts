import "temporal-polyfill/global";
import { describe, expect, it } from "vitest";

import {
  alertaBloqueante,
  evaluarResolucion,
  numerosDisponibles,
  siguienteConsecutivo,
} from "../src/modules/configuracion/configuracion.rules.js";
import { updateEmpresaSchema, updateResolucionSchema } from "../src/modules/configuracion/configuracion.schemas.js";
import { calcularDigitoVerificacion } from "../src/shared/nit.js";

const date = (value: string) => Temporal.PlainDate.from(value);

const resolucion = (overrides = {}) => ({
  prefijoFacturacion: "SETP",
  numeroResolucion: "18760000001",
  rangoDesde: 1,
  rangoHasta: 100,
  consecutivoActual: null as number | null,
  vigenciaDesde: date("2026-01-01"),
  vigenciaHasta: date("2026-12-31"),
  ...overrides,
});

const HOY = date("2026-06-01");

describe("digito de verificacion", () => {
  it.each([
    ["900123456", "8"],
    ["800197268", "4"],
    ["860034313", "7"],
  ])("NIT %s -> DV %s", (nit, dv) => {
    expect(calcularDigitoVerificacion(nit)).toBe(dv);
  });
});

describe("numeracion de la resolucion", () => {
  it("empieza en rangoDesde cuando no se ha emitido nada", () => {
    expect(siguienteConsecutivo(resolucion())).toBe(1);
    expect(numerosDisponibles(resolucion())).toBe(100);
  });

  it("continua despues del ultimo numero emitido", () => {
    expect(siguienteConsecutivo(resolucion({ consecutivoActual: 41 }))).toBe(42);
    expect(numerosDisponibles(resolucion({ consecutivoActual: 41 }))).toBe(59);
  });

  it("no tiene alertas con una resolucion sana", () => {
    expect(evaluarResolucion(resolucion(), HOY)).toEqual([]);
  });

  it("bloquea sin resolucion", () => {
    expect(alertaBloqueante(evaluarResolucion(null, HOY))?.nivel).toBe("ERROR");
  });

  it("bloquea una resolucion vencida", () => {
    const alertas = evaluarResolucion(resolucion(), date("2027-01-01"));
    expect(alertaBloqueante(alertas)?.mensaje).toContain("vencida");
  });

  it("bloquea una resolucion que aun no inicia", () => {
    const alertas = evaluarResolucion(resolucion(), date("2025-12-31"));
    expect(alertaBloqueante(alertas)?.mensaje).toContain("vigente");
  });

  it("bloquea un rango agotado", () => {
    const alertas = evaluarResolucion(resolucion({ consecutivoActual: 100 }), HOY);
    expect(alertaBloqueante(alertas)?.mensaje).toContain("agoto");
  });

  it("advierte cuando queda poco rango o poca vigencia", () => {
    const alertas = evaluarResolucion(resolucion({ consecutivoActual: 95 }), date("2026-12-15"));
    expect(alertaBloqueante(alertas)).toBeNull();
    expect(alertas.map((alerta) => alerta.nivel)).toEqual(["ADVERTENCIA", "ADVERTENCIA"]);
  });
});

describe("schemas de configuracion", () => {
  const empresa = { nit: "900123456", digitoVerificacion: "8", razonSocial: "Taller" };

  it("acepta un NIT con su DV correcto", () => {
    expect(updateEmpresaSchema.safeParse(empresa).success).toBe(true);
  });

  it("rechaza un DV que no corresponde", () => {
    expect(updateEmpresaSchema.safeParse({ ...empresa, digitoVerificacion: "1" }).success).toBe(false);
  });

  const base = {
    ambiente: "HABILITACION",
    prefijoFacturacion: "setp",
    numeroResolucion: "18760000001",
    fechaResolucion: "2019-01-19",
    rangoDesde: 990000000,
    rangoHasta: 995000000,
    vigenciaDesde: "2019-01-19",
    vigenciaHasta: "2030-01-19",
  };

  it("normaliza el prefijo a mayusculas", () => {
    expect(updateResolucionSchema.parse(base).prefijoFacturacion).toBe("SETP");
  });

  it("rechaza rangos y vigencias invertidos", () => {
    expect(updateResolucionSchema.safeParse({ ...base, rangoHasta: 1 }).success).toBe(false);
    expect(updateResolucionSchema.safeParse({ ...base, vigenciaHasta: "2018-01-01" }).success).toBe(false);
  });

  it("rechaza prefijos de mas de 4 caracteres", () => {
    expect(updateResolucionSchema.safeParse({ ...base, prefijoFacturacion: "FACTX" }).success).toBe(false);
  });
});
