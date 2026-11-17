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

const S = await import("../src/modules/catalogo/catalogo.service.js");
const C = await import("../src/modules/catalogo/catalogo.controller.js");

const ID = "33333333-3333-4333-8333-333333333333";
const nuevo = { codigo: "C1", nombre: "Aceite", tipo: "REPUESTO", precioVenta: 100, tarifaIva: 19, tratamientoIva: "GRAVADO" } as any;
const fila = { id: ID, codigo: "C1" };

describe("catalogo: listado", () => {
  it("sin filtros solo ordena por tipo y nombre", async () => {
    col("ItemsCatalogo")["all"].mockResolvedValue([fila]);
    expect(await S.listCatalogo({} as any)).toEqual([fila]);
    expect(h.probes).toEqual(["tipo.asc()", "nombre.asc()"]);
  });

  it("con tipo, activo y busqueda arma todos los filtros con %texto%", async () => {
    await S.listCatalogo({ tipo: "SERVICIO", activo: false, search: "ace" } as any);
    expect(h.probes).toEqual(expect.arrayContaining(["tipo.eq(SERVICIO)", "activo.eq(false)", "codigo.ilike(%ace%)", "nombre.ilike(%ace%)", "descripcion.ilike(%ace%)"]));
    expect(h.probes).not.toContain("id.isNotNull()");
  });

  it("filtros ausentes se reemplazan por isNotNull", async () => {
    await S.listCatalogo({ activo: true } as any);
    expect(h.probes.filter((p) => p === "id.isNotNull()")).toHaveLength(2);
  });
});

describe("catalogo: lectura y creacion", () => {
  it("getCatalogoItemById devuelve o 404", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValueOnce(fila);
    expect(await S.getCatalogoItemById(ID)).toBe(fila);
    expect(await status(S.getCatalogoItemById(ID))).toBe(404);
  });

  it("crea convirtiendo precios a texto con tipo de columna", async () => {
    col("ItemsCatalogo")["create"].mockResolvedValue(fila);
    expect(await S.createCatalogoItem(nuevo)).toBe(fila);
    expect(col("ItemsCatalogo")["create"]).toHaveBeenCalledWith(expect.objectContaining({ codigo: "C1", precioVenta: "100", tarifaIva: "19" }));
    expect(wheres("ItemsCatalogo")).toEqual([{ codigo: "C1" }]);
  });

  it("409 si el codigo ya existe, ya sea por consulta previa o por la base", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValueOnce(fila);
    expect(await status(S.createCatalogoItem(nuevo))).toBe(409);
    expect(col("ItemsCatalogo")["create"]).not.toHaveBeenCalled();
    col("ItemsCatalogo")["create"].mockRejectedValueOnce({ code: "23505" });
    expect(await status(S.createCatalogoItem(nuevo))).toBe(409);
    const boom = new Error("boom");
    col("ItemsCatalogo")["create"].mockRejectedValueOnce(boom);
    expect(await status(S.createCatalogoItem(nuevo))).toBe(boom);
  });
});

describe("catalogo: actualizacion", () => {
  it("404 si no existe", async () => {
    expect(await status(S.updateCatalogoItem(ID, { nombre: "x" }))).toBe(404);
  });

  it("actualiza solo los campos enviados y devuelve el item releido", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValue(fila);
    await S.updateCatalogoItem(ID, { nombre: "Nuevo", precioVenta: 5, tarifaIva: 0 } as any);
    expect(col("ItemsCatalogo")["update"]).toHaveBeenCalledWith({
      nombre: "Nuevo", precioVenta: "5", tarifaIva: "0", codigo: undefined,
    });
  });

  it("cambiar codigo: 409 si lo usa otro item, permitido si es el mismo", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValueOnce(fila).mockResolvedValueOnce({ id: "otro" });
    expect(await status(S.updateCatalogoItem(ID, { codigo: "C2" }))).toBe(409);
    col("ItemsCatalogo")["first"].mockResolvedValue(fila);
    await S.updateCatalogoItem(ID, { codigo: "C1" });
    expect(col("ItemsCatalogo")["update"]).toHaveBeenCalledWith(expect.objectContaining({ codigo: "C1" }));
  });

  it("traduce el unique de la base a 409 y propaga otros errores", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValue(fila);
    col("ItemsCatalogo")["update"].mockRejectedValueOnce(new Error("duplicate key value"));
    expect(await status(S.updateCatalogoItem(ID, { nombre: "x" }))).toBe(409);
    const boom = new Error("boom");
    col("ItemsCatalogo")["update"].mockRejectedValueOnce(boom);
    expect(await status(S.updateCatalogoItem(ID, { nombre: "x" }))).toBe(boom);
  });
});

describe("catalogo: controlador", () => {
  it("listar valida la query; obtener, crear (201) y actualizar", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValue(fila);
    col("ItemsCatalogo")["create"].mockResolvedValue(fila);
    expect((await llamar(C.listCatalogoController, { query: { activo: "true" } })).res.json).toHaveBeenCalledWith({ data: [] });
    expect((await llamar(C.listCatalogoController, { query: { tipo: "NOPE" } })).next).toHaveBeenCalled();
    expect((await llamar(C.getCatalogoItemController, { params: { id: ID } })).res.json).toHaveBeenCalledWith({ data: fila });
    col("ItemsCatalogo")["first"].mockResolvedValueOnce(undefined);
    const crear = await llamar(C.createCatalogoItemController, { body: nuevo });
    expect(crear.res.status).toHaveBeenCalledWith(201);
    expect(crear.res.json).toHaveBeenCalledWith({ data: fila });
    const upd = await llamar(C.updateCatalogoItemController, { params: { id: ID }, body: { nombre: "x" } });
    expect(upd.res.json).toHaveBeenCalledWith({ data: fila });
  });

  it("un error del servicio llega a next", async () => {
    const { next } = await llamar(C.getCatalogoItemController, { params: { id: ID } });
    expect(next.mock.calls[0]![0].statusCode).toBe(404);
  });
});
