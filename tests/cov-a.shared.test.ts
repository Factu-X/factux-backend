
import "temporal-polyfill/global";
import { describe, expect, it } from "vitest";

import { isForeignKeyError, isUniqueConstraintError } from "../src/shared/db-errors.js";
import { decimalFromScale, parseDecimalToScale, roundDiv } from "../src/shared/decimal.js";
import { HttpError } from "../src/shared/http-error.js";
import { nullableVarchar, numeric, optionalVarchar, varchar } from "../src/shared/prisma-types.js";
import { hoyColombia, nowInstant, parseInstant, ZONA_COLOMBIA } from "../src/shared/time.js";

describe("db-errors", () => {
  it("detecta unique por codigo de Postgres, de Prisma o por mensaje", () => {
    expect(isUniqueConstraintError({ code: "23505" })).toBe(true);
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraintError(new Error("Duplicate KEY value violates"))).toBe(true);
    expect(isUniqueConstraintError(new Error("UNIQUE constraint failed"))).toBe(true);
  });

  it("no confunde otros errores con unique", () => {
    expect(isUniqueConstraintError(new Error("timeout"))).toBe(false);
    expect(isUniqueConstraintError({ code: "23503" })).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError("duplicate key")).toBe(false);
  });

  it("detecta foreign key por codigo o por mensaje", () => {
    expect(isForeignKeyError({ code: "23503" })).toBe(true);
    expect(isForeignKeyError(new Error("violates Foreign Key constraint"))).toBe(true);
    expect(isForeignKeyError({ code: "23505" })).toBe(false);
    expect(isForeignKeyError(undefined)).toBe(false);
  });
});

describe("prisma-types", () => {
  it("varchar y numeric devuelven texto; numeric acepta numeros", () => {
    expect(varchar<5>("abc")).toBe("abc");
    expect(numeric<14, 2>(12.5)).toBe("12.5");
    expect(numeric<14, 2>("7.00")).toBe("7.00");
  });

  it("optionalVarchar y nullableVarchar conservan undefined y null", () => {
    expect(optionalVarchar<5>(undefined)).toBeUndefined();
    expect(optionalVarchar<5>("a")).toBe("a");
    expect(nullableVarchar<5>(null)).toBeNull();
    expect(nullableVarchar<5>(undefined)).toBeUndefined();
    expect(nullableVarchar<5>("a")).toBe("a");
  });
});

describe("time", () => {
  it("parseInstant lee ISO y rechaza texto invalido con 400", () => {
    expect(parseInstant("2026-01-02T03:04:05Z", "f").toString()).toBe("2026-01-02T03:04:05Z");
    try {
      parseInstant("ayer", "fechaIngreso");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(400);
      expect((e as HttpError).message).toContain("fechaIngreso");
    }
  });

  it("nowInstant y hoyColombia usan el reloj y la zona de Bogota", () => {
    expect(nowInstant()).toBeInstanceOf(Temporal.Instant);
    expect(ZONA_COLOMBIA).toBe("America/Bogota");
    expect(hoyColombia()).toBe(Temporal.Now.plainDateISO("America/Bogota").toString());
    expect(hoyColombia()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("decimal", () => {
  it("convierte a enteros escalados, incluyendo negativos y relleno de decimales", () => {
    expect(parseDecimalToScale("12.5", 2, "x")).toBe(1250n);
    expect(parseDecimalToScale(3, 2, "x")).toBe(300n);
    expect(parseDecimalToScale(" -0.05 ", 2, "x")).toBe(-5n);
  });

  it("rechaza texto no decimal, no finitos y exceso de decimales con 400", () => {
    const codigo = (v: any, scale = 2) => {
      try { parseDecimalToScale(v, scale, "campo"); return null; } catch (e) { return (e as HttpError).statusCode; }
    };
    expect(codigo("abc")).toBe(400);
    expect(codigo("")).toBe(400);
    expect(codigo("1,5")).toBe(400);
    expect(codigo(Infinity)).toBe(400);
    expect(codigo(NaN)).toBe(400);
    expect(codigo("1.234")).toBe(400);
  });

  it("decimalFromScale formatea con ceros a la izquierda, signo y escala 0", () => {
    expect(decimalFromScale(1250n, 2)).toBe("12.50");
    expect(decimalFromScale(5n, 2)).toBe("0.05");
    expect(decimalFromScale(-5n, 2)).toBe("-0.05");
    expect(decimalFromScale(42n, 0)).toBe("42");
  });

  it("roundDiv redondea hacia arriba en la mitad y exige divisor positivo", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(() => roundDiv(1n, 0n)).toThrow("divisor");
    expect(() => roundDiv(1n, -2n)).toThrow();
  });
});
