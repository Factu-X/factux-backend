import "temporal-polyfill/global";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ORM simulado: cada coleccion encadena where/include/orderBy y expone terminales vi.fn() para controlar resultados.
const h = vi.hoisted(() => {
  const cols = new Map<string, any>();
  const probes: string[] = [];
  const probe = (path: string): any =>
    new Proxy(function () {}, {
      get: (_t, k) => (typeof k === "symbol" ? undefined : probe(path ? `${path}.${String(k)}` : String(k))),
      apply: (_t, _s, args) => {
        probes.push(`${path}(${args.join(",")})`);
        return probe(path);
      },
    });
  const makeCol = () => {
    const t: Record<string, any> = {
      first: vi.fn(), all: vi.fn().mockResolvedValue([]), create: vi.fn(), createAll: vi.fn(),
      update: vi.fn(), delete: vi.fn(),
    };
    const chain: any = new Proxy({}, {
      get: (_o, k: string) =>
        t[k] ??
        ((...args: any[]) => {
          t["log"] = [...(t["log"] ?? []), [k, args.filter((a) => typeof a !== "function")]];
          for (const a of args.flat()) if (typeof a === "function") a(probe(""));
          return chain;
        }),
    });
    return { chain, t };
  };
  const get = (name: string) => {
    if (!cols.has(name)) cols.set(name, makeCol());
    return cols.get(name);
  };
  const db: any = { orm: { public: new Proxy({}, { get: (_o, name: string) => get(name).chain }) } };
  db.transaction = (fn: (tx: any) => unknown) => fn(db);
  return { cols, probes, col: (name: string) => get(name).t as Record<string, any>, db };
});

vi.mock("../src/prisma/db.js", () => ({ db: h.db }));
vi.mock("@prisma/orm-postgres/orm-client", () => ({
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
}));

const col = h.col;
const wheres = (name: string) => (col(name)["log"] ?? []).filter((c: any) => c[0] === "where").map((c: any) => c[1][0]);
const status = async (p: Promise<unknown>) => p.then(() => null, (e) => e.statusCode ?? e);

// Ejecuta el handler, espera a que asyncHandler termine y devuelve res/next.
const llamar = async (handler: any, req: Record<string, unknown> = {}) => {
  const res: any = {};
  for (const m of ["status", "json", "send", "type", "set"]) res[m] = vi.fn(() => res);
  const next = vi.fn();
  await handler({ params: {}, query: {}, body: {}, ...req }, res, next);
  await new Promise((r) => setTimeout(r, 0));
  return { res, next };
};

beforeEach(() => {
  h.cols.clear();
  h.probes.length = 0;
});

const S = await import("../src/modules/motocicletas/motocicletas.service.js");
const C = await import("../src/modules/motocicletas/motocicletas.controller.js");

const CLI = "11111111-1111-4111-8111-111111111111";
const ID = "33333333-3333-4333-8333-333333333333";
const nueva = { placa: "ABC12D", marca: "Honda", modelo: "CB" } as any;
const fila = { id: ID, placa: "ABC12D" };

describe("motocicletas: por cliente", () => {
  it("lista las motos del cliente ordenadas por placa; 404 si el cliente no existe", async () => {
    expect(await status(S.listMotocicletasByCliente(CLI))).toBe(404);
    col("Clientes")["first"].mockResolvedValue({ id: CLI });
    col("Motocicletas")["all"].mockResolvedValue([fila]);
    expect(await S.listMotocicletasByCliente(CLI)).toEqual([fila]);
    expect(wheres("Motocicletas")).toEqual([{ clienteId: CLI }]);
    expect(h.probes).toContain("placa.asc()");
  });
});

describe("motocicletas: lectura y creacion", () => {
  it("getMotocicletaById devuelve o 404", async () => {
    col("Motocicletas")["first"].mockResolvedValueOnce(fila);
    expect(await S.getMotocicletaById(ID)).toBe(fila);
    expect(await status(S.getMotocicletaById(ID))).toBe(404);
  });

  it("crea asociada al cliente tras verificar que no hay placa activa repetida", async () => {
    col("Clientes")["first"].mockResolvedValue({ id: CLI });
    col("Motocicletas")["create"].mockResolvedValue(fila);
    expect(await S.createMotocicleta(CLI, nueva)).toBe(fila);
    expect(col("Motocicletas")["create"]).toHaveBeenCalledWith(expect.objectContaining({ clienteId: CLI, placa: "ABC12D" }));
    expect(h.probes).toEqual(expect.arrayContaining(["activa.eq(true)", "placa.ilike(ABC12D)", "id.isNotNull()"]));
  });

  it("404 si el cliente no existe; 409 si la placa esta activa; traduce unique y FK de la base", async () => {
    expect(await status(S.createMotocicleta(CLI, nueva))).toBe(404);
    col("Clientes")["first"].mockResolvedValue({ id: CLI });
    col("Motocicletas")["first"].mockResolvedValueOnce(fila);
    expect(await status(S.createMotocicleta(CLI, nueva))).toBe(409);
    col("Motocicletas")["create"].mockRejectedValueOnce({ code: "23505" });
    expect(await status(S.createMotocicleta(CLI, nueva))).toBe(409);
    col("Motocicletas")["create"].mockRejectedValueOnce({ code: "23503" });
    expect(await status(S.createMotocicleta(CLI, nueva))).toBe(404);
    const boom = new Error("boom");
    col("Motocicletas")["create"].mockRejectedValueOnce(boom);
    expect(await status(S.createMotocicleta(CLI, nueva))).toBe(boom);
  });
});

describe("motocicletas: actualizacion", () => {
  it("404 si no existe", async () => {
    expect(await status(S.updateMotocicleta(ID, { marca: "x" }))).toBe(404);
  });

  it("actualiza sin placa: no consulta duplicados y deja undefined lo no enviado", async () => {
    col("Motocicletas")["first"].mockResolvedValue(fila);
    expect(await S.updateMotocicleta(ID, { marca: "Yamaha" })).toBe(fila);
    expect(col("Motocicletas")["update"]).toHaveBeenCalledWith(expect.objectContaining({ marca: "Yamaha", placa: undefined, modelo: undefined }));
    expect(h.probes).toEqual([]);
  });

  it("cambiar placa: excluye la propia moto y da 409 si otra activa la tiene", async () => {
    col("Motocicletas")["first"].mockResolvedValueOnce(fila).mockResolvedValueOnce({ id: "otra" });
    expect(await status(S.updateMotocicleta(ID, { placa: "XYZ99Z" }))).toBe(409);
    expect(h.probes).toContain(`id.neq(${ID})`);
  });

  it("traduce unique de la base a 409 y propaga otros errores", async () => {
    col("Motocicletas")["first"].mockResolvedValueOnce(fila).mockResolvedValueOnce(undefined).mockResolvedValue(fila);
    col("Motocicletas")["update"].mockRejectedValueOnce({ code: "23505" });
    expect(await status(S.updateMotocicleta(ID, { placa: "XYZ99Z" }))).toBe(409);
    const boom = new Error("boom");
    col("Motocicletas")["update"].mockRejectedValueOnce(boom);
    expect(await status(S.updateMotocicleta(ID, { marca: "x" }))).toBe(boom);
  });
});

describe("motocicletas: controlador", () => {
  it("listar por cliente, obtener, crear (201) y actualizar", async () => {
    col("Clientes")["first"].mockResolvedValue({ id: CLI });
    col("Motocicletas")["all"].mockResolvedValue([fila]);
    expect((await llamar(C.listMotocicletasByClienteController, { params: { clienteId: CLI } })).res.json).toHaveBeenCalledWith({ data: [fila] });
    col("Motocicletas")["first"].mockResolvedValue(fila);
    expect((await llamar(C.getMotocicletaController, { params: { id: ID } })).res.json).toHaveBeenCalledWith({ data: fila });
    col("Motocicletas")["first"].mockResolvedValueOnce(undefined);
    col("Motocicletas")["create"].mockResolvedValue(fila);
    const crear = await llamar(C.createMotocicletaController, { params: { clienteId: CLI }, body: nueva });
    expect(crear.res.status).toHaveBeenCalledWith(201);
    expect((await llamar(C.updateMotocicletaController, { params: { id: ID }, body: { marca: "x" } })).res.json).toHaveBeenCalledWith({ data: fila });
  });

  it("un error del servicio llega a next", async () => {
    const { next } = await llamar(C.getMotocicletaController, { params: { id: ID } });
    expect(next.mock.calls[0]![0].statusCode).toBe(404);
  });
});
