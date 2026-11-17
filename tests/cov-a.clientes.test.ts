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

const S = await import("../src/modules/clientes/clientes.service.js");
const C = await import("../src/modules/clientes/clientes.controller.js");

const ID = "33333333-3333-4333-8333-333333333333";
const nuevo = { numeroIdentificacion: "123", nombreRazonSocial: "Ana", tipoIdentificacion: "CC" } as any;
const fila = { id: ID, nombreRazonSocial: "Ana" };

describe("clientes: listado", () => {
  it("sin busqueda ordena por nombre e incluye motos por placa", async () => {
    col("Clientes")["all"].mockResolvedValue([fila]);
    expect(await S.listClientes({} as any)).toEqual([fila]);
    expect(h.probes).toHaveLength(2);
    expect(h.probes[1]).toBe("nombreRazonSocial.asc()");
    expect(col("Clientes")["log"].map((c: any) => c[0])).toEqual(["include", "orderBy"]);
  });

  it("con busqueda filtra por identificacion o nombre con %texto%", async () => {
    await S.listClientes({ search: "an" } as any);
    expect(h.probes).toEqual(expect.arrayContaining(["numeroIdentificacion.ilike(%an%)", "nombreRazonSocial.ilike(%an%)"]));
  });
});

describe("clientes: lectura y creacion", () => {
  it("getClienteById devuelve o 404", async () => {
    col("Clientes")["first"].mockResolvedValueOnce(fila);
    expect(await S.getClienteById(ID)).toBe(fila);
    expect(await status(S.getClienteById(ID))).toBe(404);
  });

  it("crea normalizando opcionales a null/undefined segun el input", async () => {
    col("Clientes")["create"].mockResolvedValue(fila);
    await S.createCliente({ ...nuevo, email: null, telefono: "300" });
    expect(col("Clientes")["create"]).toHaveBeenCalledWith(expect.objectContaining({ numeroIdentificacion: "123", email: null, telefono: "300", direccion: undefined }));
    expect(wheres("Clientes")).toEqual([{ numeroIdentificacion: "123" }]);
  });

  it("409 por identificacion repetida (consulta previa o restriccion unique) y propaga otros errores", async () => {
    col("Clientes")["first"].mockResolvedValueOnce(fila);
    expect(await status(S.createCliente(nuevo))).toBe(409);
    col("Clientes")["create"].mockRejectedValueOnce({ code: "P2002" });
    expect(await status(S.createCliente(nuevo))).toBe(409);
    const boom = new Error("boom");
    col("Clientes")["create"].mockRejectedValueOnce(boom);
    expect(await status(S.createCliente(nuevo))).toBe(boom);
  });
});

describe("clientes: actualizacion", () => {
  it("404 si no existe", async () => {
    expect(await status(S.updateCliente(ID, { nombreRazonSocial: "x" }))).toBe(404);
  });

  it("actualiza y devuelve el cliente releido; campos ausentes quedan undefined", async () => {
    col("Clientes")["first"].mockResolvedValue(fila);
    expect(await S.updateCliente(ID, { nombreRazonSocial: "Luis", direccion: null } as any)).toBe(fila);
    expect(col("Clientes")["update"]).toHaveBeenCalledWith(expect.objectContaining({ nombreRazonSocial: "Luis", direccion: null, numeroIdentificacion: undefined, email: undefined }));
  });

  it("cambiar identificacion: 409 si es de otro cliente, ok si es el mismo", async () => {
    col("Clientes")["first"].mockResolvedValueOnce(fila).mockResolvedValueOnce({ id: "otro" });
    expect(await status(S.updateCliente(ID, { numeroIdentificacion: "999" }))).toBe(409);
    col("Clientes")["first"].mockResolvedValue(fila);
    await S.updateCliente(ID, { numeroIdentificacion: "123" });
    expect(col("Clientes")["update"]).toHaveBeenCalledWith(expect.objectContaining({ numeroIdentificacion: "123" }));
  });

  it("traduce unique de la base a 409 y propaga otros errores", async () => {
    col("Clientes")["first"].mockResolvedValue(fila);
    col("Clientes")["update"].mockRejectedValueOnce({ code: "23505" });
    expect(await status(S.updateCliente(ID, { nombreRazonSocial: "x" }))).toBe(409);
    const boom = new Error("boom");
    col("Clientes")["update"].mockRejectedValueOnce(boom);
    expect(await status(S.updateCliente(ID, { nombreRazonSocial: "x" }))).toBe(boom);
  });
});

describe("clientes: controlador", () => {
  it("listar, obtener, crear (201) y actualizar", async () => {
    col("Clientes")["first"].mockResolvedValue(fila);
    col("Clientes")["create"].mockResolvedValue(fila);
    expect((await llamar(C.listClientesController, { query: { search: "a" } })).res.json).toHaveBeenCalledWith({ data: [] });
    expect((await llamar(C.getClienteController, { params: { id: ID } })).res.json).toHaveBeenCalledWith({ data: fila });
    col("Clientes")["first"].mockResolvedValueOnce(undefined);
    const crear = await llamar(C.createClienteController, { body: nuevo });
    expect(crear.res.status).toHaveBeenCalledWith(201);
    expect((await llamar(C.updateClienteController, { params: { id: ID }, body: { nombreRazonSocial: "x" } })).res.json).toHaveBeenCalledWith({ data: fila });
  });

  it("un error del servicio llega a next", async () => {
    const { next } = await llamar(C.getClienteController, { params: { id: ID } });
    expect(next.mock.calls[0]![0].statusCode).toBe(404);
  });
});
