import { describe, expect, it } from "vitest";

import {
  calcularDvNit,
  evaluarConfiguracion,
  SECRETOS,
  siguienteConsecutivo,
} from "../src/modules/configuracion/configuracion.rules.js";
import type {
  EmpresaConfig,
  NumeracionConfig,
} from "../src/modules/configuracion/configuracion.rules.js";

const empresa: EmpresaConfig = {
  nit: "800197268",
  digitoVerificacion: "4",
  razonSocial: "Taller Demo SAS",
  direccion: "Cra 45 # 80-23",
  ciudad: "Medellin",
  departamento: "Antioquia",
  codigoMunicipio: "05001",
  telefono: "3001234567",
  email: "facturacion@taller.co",
  responsabilidadesFiscales: "O-13",
};

const numeracion: NumeracionConfig = {
  ambiente: "HABILITACION",
  numeroResolucion: "18760000001",
  fechaResolucion: "2026-01-01",
  rangoDesde: 1,
  rangoHasta: 100,
  consecutivoActual: 0,
  vigenciaDesde: "2026-01-01",
  vigenciaHasta: "2027-12-31",
  softwareId: "software-1",
  testSetId: "test-set-1",
  certificadoPath: "dian/certificado.p12",
  certificadoExpira: "2027-06-30",
};

const todos = new Set<string>(Object.values(SECRETOS));
const HOY = "2026-10-15";

describe("calcularDvNit", () => {
  it("computes the official DIAN check digit", () => {
    expect(calcularDvNit("800197268")).toBe("4"); // NIT de la DIAN
    expect(calcularDvNit("900123456")).toBe("8");
  });
});

describe("siguienteConsecutivo", () => {
  it("starts at the beginning of the range and then increments", () => {
    expect(siguienteConsecutivo({ rangoDesde: 990, consecutivoActual: 989 })).toBe(990);
    expect(siguienteConsecutivo({ rangoDesde: 990, consecutivoActual: 995 })).toBe(996);
    expect(siguienteConsecutivo({ rangoDesde: 990, consecutivoActual: null })).toBe(990);
  });
});

describe("evaluarConfiguracion", () => {
  it("allows issuing and transmitting when everything is configured", () => {
    const estado = evaluarConfiguracion(empresa, numeracion, todos, HOY);
    expect(estado).toMatchObject({ puedeEmitir: true, puedeTransmitir: true });
  });

  it("blocks issuing without company or numbering data", () => {
    const estado = evaluarConfiguracion(null, null, new Set(), HOY);
    expect(estado.puedeEmitir).toBe(false);
    expect(estado.faltantesEmision).toEqual(
      expect.arrayContaining([
        "Datos de la empresa",
        "Resolucion y rango de numeracion",
        "Clave tecnica de la resolucion",
        "PIN del software",
      ]),
    );
  });

  it("blocks issuing with an expired resolution or an exhausted range", () => {
    expect(
      evaluarConfiguracion(empresa, { ...numeracion, vigenciaHasta: "2026-10-14" }, todos, HOY)
        .faltantesEmision,
    ).toContain("Resolucion fuera de vigencia");
    expect(
      evaluarConfiguracion(empresa, { ...numeracion, consecutivoActual: 100 }, todos, HOY)
        .faltantesEmision,
    ).toContain("Rango de numeracion agotado");
  });

  it("flags a check digit that does not match the NIT", () => {
    const estado = evaluarConfiguracion(
      { ...empresa, digitoVerificacion: "7" },
      numeracion,
      todos,
      HOY,
    );
    expect(estado.faltantesEmision).toContain("Digito de verificacion no corresponde al NIT");
  });

  it("allows issuing but not transmitting without a certificate", () => {
    const sinCertificado = new Set<string>([SECRETOS.claveTecnica, SECRETOS.pin]);
    const estado = evaluarConfiguracion(empresa, numeracion, sinCertificado, HOY);
    expect(estado).toMatchObject({ puedeEmitir: true, puedeTransmitir: false });
    expect(estado.faltantesTransmision).toContain("Certificado digital");
  });

  it("warns without blocking when the resolution is about to expire or run out", () => {
    const estado = evaluarConfiguracion(
      empresa,
      { ...numeracion, vigenciaHasta: Temporal.PlainDate.from(HOY).add({ days: 10 }).toString(), consecutivoActual: 95 },
      todos,
      HOY,
    );
    expect(estado.puedeEmitir).toBe(true);
    expect(estado.advertencias).toEqual([
      "Quedan 5 numero(s) en el rango autorizado",
      "La resolucion vence en 10 dia(s)",
    ]);
    expect(evaluarConfiguracion(empresa, numeracion, todos, HOY).advertencias).toEqual([]);
  });
});
