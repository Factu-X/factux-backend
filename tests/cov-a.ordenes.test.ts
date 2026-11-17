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

const S = await import("../src/modules/ordenes/ordenes.service.js");
const C = await import("../src/modules/ordenes/ordenes.controller.js");

const CLI = "11111111-1111-4111-8111-111111111111";
const MOTO = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const DET = "44444444-4444-4444-8444-444444444444";

const orden = (extra: Record<string, unknown> = {}) => ({
  id: ID, clienteId: CLI, motocicletaId: MOTO, estado: "ABIERTA", kilometrajeIngreso: 100, ...extra,
});
const item = (extra: Record<string, unknown> = {}) => ({
  id: "i1", codigo: "C1", nombre: "Aceite", tipo: "REPUESTO", activo: true, precioVenta: "100.00",
  tratamientoIva: "GRAVADO", tarifaIva: "19.00", ...extra,
});
const detalleRow = (extra: Record<string, unknown> = {}) => ({
  id: DET, ordenId: ID, cantidad: "2.00", precioUnitario: "100.00", tratamientoIva: "GRAVADO", tarifaIva: "19.00",
  subtotal: "200.00", impuesto: "38.00", total: "238.00", ...extra,
});

// Prepara cliente y moto validos para assertMotocicletaBelongsToCliente.
const clienteYMoto = (km: number | null = 50) => {
  col("Clientes")["first"].mockResolvedValue({ id: CLI });
  col("Motocicletas")["first"].mockResolvedValue({ id: MOTO, clienteId: CLI, kilometrajeActual: km });
};

describe("ordenes: listado", () => {
  it("con motocicletaId filtra, incluye detalles y ordena por ingreso", async () => {
    await S.listOrdenes({ motocicletaId: MOTO, estado: "ABIERTA", clienteId: CLI } as any);
    expect(h.probes).toEqual(expect.arrayContaining([`motocicletaId.eq(${MOTO})`, "estado.eq(ABIERTA)", `clienteId.eq(${CLI})`]));
    expect(h.probes).toContain("fechaIngreso.desc()");
    expect(col("OrdenesServicio")["all"]).toHaveBeenCalled();
  });

  it("con motocicletaId sin otros filtros usa isNotNull como comodin", async () => {
    await S.listOrdenes({ motocicletaId: MOTO } as any);
    expect(h.probes.filter((p) => p === "id.isNotNull()")).toHaveLength(2);
  });

  it("con estado o cliente aplica solo esos filtros", async () => {
    await S.listOrdenes({ estado: "EN_PROCESO" } as any);
    expect(h.probes).toContain("estado.eq(EN_PROCESO)");
    expect(h.probes).toContain("id.isNotNull()");
    h.probes.length = 0;
    await S.listOrdenes({ clienteId: CLI } as any);
    expect(h.probes).toContain(`clienteId.eq(${CLI})`);
  });

  it("sin filtros solo ordena", async () => {
    col("OrdenesServicio")["all"].mockResolvedValue([orden()]);
    expect(await S.listOrdenes({} as any)).toEqual([orden()]);
    expect(h.probes).toEqual(["fechaIngreso.desc()"]);
  });
});

describe("ordenes: lecturas", () => {
  it("getOrdenById devuelve la orden o 404", async () => {
    col("OrdenesServicio")["first"].mockResolvedValueOnce(orden());
    expect(await S.getOrdenById(ID)).toEqual(orden());
    expect(wheres("OrdenesServicio")).toEqual([{ id: ID }]);
    expect(await status(S.getOrdenById(ID))).toBe(404);
  });

  it("listDetallesOrden exige que la orden exista", async () => {
    expect(await status(S.listDetallesOrden(ID))).toBe(404);
    col("OrdenesServicio")["first"].mockResolvedValue(orden());
    col("DetallesOrden")["all"].mockResolvedValue([detalleRow()]);
    expect(await S.listDetallesOrden(ID)).toEqual([detalleRow()]);
    expect(h.probes).toContain("createdAt.asc()");
  });
});

describe("ordenes: recalcularTotalesOrden", () => {
  it("suma los detalles y guarda totales como texto con 2 decimales", async () => {
    col("DetallesOrden")["all"].mockResolvedValue([detalleRow(), detalleRow({ subtotal: "10.50", impuesto: "0.00", total: "10.50" })]);
    col("OrdenesServicio")["update"].mockResolvedValue(orden({ total: "248.50" }));
    const r = await S.recalcularTotalesOrden(ID);
    expect(col("OrdenesServicio")["update"]).toHaveBeenCalledWith({ subtotal: "210.50", impuestos: "38.00", total: "248.50" });
    expect(r.total).toBe("248.50");
  });

  it("sin detalles deja todo en cero y 404 si la orden no existe", async () => {
    expect(await status(S.recalcularTotalesOrden(ID))).toBe(404);
    expect(col("OrdenesServicio")["update"]).toHaveBeenCalledWith({ subtotal: "0.00", impuestos: "0.00", total: "0.00" });
  });
});

describe("ordenes: createOrden", () => {
  const input = { clienteId: CLI, motocicletaId: MOTO, kilometrajeIngreso: 200, motivoIngreso: "Ruido" } as any;

  beforeEach(() => {
    clienteYMoto(50);
    col("OrdenesServicio")["create"].mockResolvedValue(orden());
    col("OrdenesServicio")["update"].mockResolvedValue(orden({ total: "0.00" }));
  });

  it("crea la orden ABIERTA con numero OS-..., totales en cero y sube el kilometraje de la moto", async () => {
    await S.createOrden(input, "user-1");
    const data = col("OrdenesServicio")["create"].mock.calls[0]![0];
    expect(data.numero).toMatch(/^OS-\d{14}-[0-9A-F]{4}$/);
    expect(data).toMatchObject({ estado: "ABIERTA", creadaPor: "user-1", observaciones: null, subtotal: "0.00", total: "0.00", finalizadaAt: null });
    expect(data.fechaIngreso).toBeInstanceOf(Temporal.Instant);
    expect(col("Motocicletas")["update"]).toHaveBeenCalledWith({ kilometrajeActual: 200 });
  });

  it("respeta estado, fechaIngreso y observaciones; creadaPor ausente queda null", async () => {
    await S.createOrden({ ...input, estado: "EN_PROCESO", fechaIngreso: "2026-01-02T03:04:05Z", observaciones: "x" });
    const data = col("OrdenesServicio")["create"].mock.calls[0]![0];
    expect(data).toMatchObject({ estado: "EN_PROCESO", creadaPor: null, observaciones: "x" });
    expect(data.fechaIngreso.toString()).toBe("2026-01-02T03:04:05Z");
  });

  it("fechaIngreso invalida da 400", async () => {
    expect(await status(S.createOrden({ ...input, fechaIngreso: "ayer" }))).toBe(400);
  });

  it("no baja el kilometraje de la moto si el de ingreso es menor, pero lo fija si estaba vacio", async () => {
    clienteYMoto(500);
    await S.createOrden(input);
    expect(col("Motocicletas")["update"]).not.toHaveBeenCalled();
    clienteYMoto(null);
    await S.createOrden(input);
    expect(col("Motocicletas")["update"]).toHaveBeenCalledWith({ kilometrajeActual: 200 });
  });

  it("crea los detalles con el snapshot del item y precio aplicado opcional", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValue(item());
    await S.createOrden({ ...input, detalles: [{ itemCatalogoId: "i1", cantidad: 2 }, { itemCatalogoId: "i1", cantidad: 1, precioAplicado: "50" }] });
    const [a, b] = col("DetallesOrden")["create"].mock.calls.map((c: any) => c[0]);
    expect(a).toMatchObject({ ordenId: ID, codigoItem: "C1", cantidad: "2.00", precioUnitario: "100.00", subtotal: "200.00", impuesto: "38.00", total: "238.00" });
    expect(b).toMatchObject({ precioUnitario: "50.00", impuesto: "9.50", total: "59.50" });
  });

  it("falla con 404 si cliente, moto o item no existen y 400 si la moto es de otro cliente o el item esta inactivo", async () => {
    col("Clientes")["first"].mockResolvedValue(undefined);
    expect(await status(S.createOrden(input))).toBe(404);
    clienteYMoto();
    col("Motocicletas")["first"].mockResolvedValue(undefined);
    expect(await status(S.createOrden(input))).toBe(404);
    col("Motocicletas")["first"].mockResolvedValue({ id: MOTO, clienteId: "otro" });
    expect(await status(S.createOrden(input))).toBe(400);
    clienteYMoto();
    const conItem = { ...input, detalles: [{ itemCatalogoId: "i1", cantidad: 1 }] };
    expect(await status(S.createOrden(conItem))).toBe(404);
    col("ItemsCatalogo")["first"].mockResolvedValue(item({ activo: false }));
    expect(await status(S.createOrden(conItem))).toBe(400);
  });

  it("si la moto desaparece al actualizar kilometraje da 404", async () => {
    col("Motocicletas")["first"].mockResolvedValueOnce({ id: MOTO, clienteId: CLI }).mockResolvedValueOnce(undefined);
    expect(await status(S.createOrden(input))).toBe(404);
  });

  it("traduce violaciones unique a 409 y foreign key a 400; otros errores se propagan", async () => {
    col("OrdenesServicio")["create"].mockRejectedValueOnce({ code: "23505" });
    expect(await status(S.createOrden(input))).toBe(409);
    col("OrdenesServicio")["create"].mockRejectedValueOnce({ code: "23503" });
    expect(await status(S.createOrden(input))).toBe(400);
    const boom = new Error("boom");
    col("OrdenesServicio")["create"].mockRejectedValueOnce(boom);
    expect(await status(S.createOrden(input))).toBe(boom);
  });
});

describe("ordenes: updateOrden", () => {
  beforeEach(() => {
    clienteYMoto(50);
    col("OrdenesServicio")["first"].mockResolvedValue(orden({ estado: "EN_PROCESO" }));
    col("OrdenesServicio")["update"].mockResolvedValue(orden());
  });

  it("404 si no existe y 403 si esta finalizada", async () => {
    col("OrdenesServicio")["first"].mockResolvedValue(undefined);
    expect(await status(S.updateOrden(ID, {}))).toBe(404);
    col("OrdenesServicio")["first"].mockResolvedValue(orden({ estado: "FINALIZADA" }));
    expect(await status(S.updateOrden(ID, {}))).toBe(403);
  });

  it("rechaza transiciones invalidas con 400", async () => {
    col("OrdenesServicio")["first"].mockResolvedValue(orden({ estado: "ABIERTA" }));
    expect(await status(S.updateOrden(ID, { estado: "FINALIZADA" }))).toBe(400);
  });

  it("no finaliza sin detalles; con detalles guarda finalizadaAt", async () => {
    expect(await status(S.updateOrden(ID, { estado: "FINALIZADA" }))).toBe(400);
    col("DetallesOrden")["all"].mockResolvedValue([detalleRow()]);
    await S.updateOrden(ID, { estado: "FINALIZADA" });
    expect(col("OrdenesServicio")["update"].mock.calls[0]![0].finalizadaAt).toBeInstanceOf(Temporal.Instant);
  });

  it("cambiar a otro estado abierto limpia finalizadaAt; sin estado lo deja intacto", async () => {
    await S.updateOrden(ID, { estado: "ABIERTA" });
    expect(col("OrdenesServicio")["update"].mock.calls[0]![0].finalizadaAt).toBeNull();
    await S.updateOrden(ID, { observaciones: "n" });
    const data = col("OrdenesServicio")["update"].mock.calls[1]![0];
    expect(data.finalizadaAt).toBeUndefined();
    expect(data.fechaIngreso).toBeUndefined();
    expect(data.observaciones).toBe("n");
    expect(col("Motocicletas")["update"]).not.toHaveBeenCalled();
  });

  it("convierte fechaIngreso y sincroniza el kilometraje de la moto", async () => {
    await S.updateOrden(ID, { fechaIngreso: "2026-05-05T00:00:00Z", kilometrajeIngreso: 900 });
    expect(col("OrdenesServicio")["update"].mock.calls[0]![0].fechaIngreso.toString()).toBe("2026-05-05T00:00:00Z");
    expect(col("Motocicletas")["update"]).toHaveBeenCalledWith({ kilometrajeActual: 900 });
  });

  it("al cambiar de moto usa el kilometraje existente de la orden", async () => {
    await S.updateOrden(ID, { motocicletaId: MOTO });
    expect(col("Motocicletas")["update"]).toHaveBeenCalledWith({ kilometrajeActual: 100 });
  });

  it("404 si el update no devuelve fila", async () => {
    col("OrdenesServicio")["update"].mockResolvedValue(undefined);
    expect(await status(S.updateOrden(ID, {}))).toBe(404);
  });
});

describe("ordenes: detalles", () => {
  beforeEach(() => {
    col("OrdenesServicio")["first"].mockResolvedValue(orden());
    col("OrdenesServicio")["update"].mockResolvedValue(orden({ total: "1.00" }));
    col("DetallesOrden")["first"].mockResolvedValue(detalleRow());
    col("ItemsCatalogo")["first"].mockResolvedValue(item());
  });

  it("addDetalleOrden crea el detalle y devuelve la orden recalculada", async () => {
    const r = await S.addDetalleOrden(ID, { itemCatalogoId: "i1", cantidad: 1 } as any);
    expect(col("DetallesOrden")["create"]).toHaveBeenCalledWith(expect.objectContaining({ ordenId: ID, total: "119.00" }));
    expect(r.total).toBe("1.00");
  });

  it("addDetalleOrden prohibe editar ordenes cerradas", async () => {
    col("OrdenesServicio")["first"].mockResolvedValue(orden({ estado: "CANCELADA" }));
    expect(await status(S.addDetalleOrden(ID, { itemCatalogoId: "i1", cantidad: 1 } as any))).toBe(403);
    expect(col("DetallesOrden")["create"]).not.toHaveBeenCalled();
  });

  it("updateDetalleOrden recalcula con cantidad y precio nuevos, conservando el IVA del detalle", async () => {
    await S.updateDetalleOrden(ID, DET, { cantidad: 3, precioAplicado: "10" } as any);
    expect(col("DetallesOrden")["update"]).toHaveBeenCalledWith({
      cantidad: "3.00", precioUnitario: "10.00", subtotal: "30.00", impuesto: "5.70", total: "35.70",
    });
  });

  it("updateDetalleOrden sin campos conserva los valores y 404 si el detalle no existe", async () => {
    await S.updateDetalleOrden(ID, DET, {});
    expect(col("DetallesOrden")["update"]).toHaveBeenCalledWith(expect.objectContaining({ cantidad: "2.00", total: "238.00" }));
    col("DetallesOrden")["first"].mockResolvedValue(undefined);
    expect(await status(S.updateDetalleOrden(ID, DET, {}))).toBe(404);
  });

  it("deleteDetalleOrden borra y recalcula; 403 en ordenes cerradas", async () => {
    await S.deleteDetalleOrden(ID, DET);
    expect(col("DetallesOrden")["delete"]).toHaveBeenCalled();
    expect(wheres("DetallesOrden")).toContainEqual({ id: DET, ordenId: ID });
    col("OrdenesServicio")["first"].mockResolvedValue(orden({ estado: "FINALIZADA" }));
    expect(await status(S.deleteDetalleOrden(ID, DET))).toBe(403);
  });
});

describe("ordenes: controlador", () => {
  beforeEach(() => {
    col("OrdenesServicio")["first"].mockResolvedValue(orden());
    col("OrdenesServicio")["update"].mockResolvedValue(orden());
    clienteYMoto();
  });

  it("listar valida la query con zod", async () => {
    const ok = await llamar(C.listOrdenesController, { query: { estado: "ABIERTA" } });
    expect(ok.res.json).toHaveBeenCalledWith({ data: [] });
    const mal = await llamar(C.listOrdenesController, { query: { estado: "NOPE" } });
    expect(mal.next).toHaveBeenCalled();
  });

  it("obtener y listar detalles", async () => {
    expect((await llamar(C.getOrdenController, { params: { id: ID } })).res.json).toHaveBeenCalledWith({ data: orden() });
    col("DetallesOrden")["all"].mockResolvedValue([detalleRow()]);
    expect((await llamar(C.listDetallesOrdenController, { params: { id: ID } })).res.json).toHaveBeenCalledWith({ data: [detalleRow()] });
  });

  it("crear responde 201 con el usuario autenticado", async () => {
    col("OrdenesServicio")["create"].mockResolvedValue(orden());
    const { res } = await llamar(C.createOrdenController, {
      body: { clienteId: CLI, motocicletaId: MOTO, kilometrajeIngreso: 10, motivoIngreso: "x" }, user: { id: "u1" },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(col("OrdenesServicio")["create"].mock.calls[0]![0].creadaPor).toBe("u1");
  });

  it("actualizar: el operador no puede tocar campos de recepcion (403 via next)", async () => {
    const { next } = await llamar(C.updateOrdenController, { params: { id: ID }, body: { motivoIngreso: "x" }, user: { rol: "OPERADOR" } });
    expect(next.mock.calls[0]![0].statusCode).toBe(403);
    const ok = await llamar(C.updateOrdenController, { params: { id: ID }, body: { observaciones: "x" }, user: { rol: "OPERADOR" } });
    expect(ok.res.json).toHaveBeenCalledWith({ data: orden() });
    const sinUsuario = await llamar(C.updateOrdenController, { params: { id: ID }, body: { observaciones: "x" } });
    expect(sinUsuario.res.json).toHaveBeenCalled();
  });

  it("agregar, actualizar y eliminar detalle", async () => {
    col("ItemsCatalogo")["first"].mockResolvedValue(item());
    col("DetallesOrden")["first"].mockResolvedValue(detalleRow());
    const add = await llamar(C.addDetalleOrdenController, { params: { id: ID }, body: { itemCatalogoId: "i1", cantidad: 1 } });
    expect(add.res.status).toHaveBeenCalledWith(201);
    const upd = await llamar(C.updateDetalleOrdenController, { params: { id: ID, detalleId: DET }, body: { cantidad: 1 } });
    expect(upd.res.json).toHaveBeenCalledWith({ data: detalleRow() });
    const del = await llamar(C.deleteDetalleOrdenController, { params: { id: ID, detalleId: DET } });
    expect(del.res.json).toHaveBeenCalledWith({ data: orden() });
  });
});
