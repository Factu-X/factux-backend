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

const S = await import("../src/modules/usabilidad/usabilidad.service.js");
const C = await import("../src/modules/usabilidad/usabilidad.controller.js");

const ID = "33333333-3333-4333-8333-333333333333";
const RESP = [4, 2, 5, 1, 4, 2, 5, 1, 4, 2]; // SUS = 85

const sesionDb = (extra: Record<string, unknown> = {}) => ({
  id: ID, participante: "Ana", perfil: "Mecanico", fechaSesion: Temporal.PlainDate.from("2026-11-10"),
  observaciones: null, susRespuestas: JSON.stringify(RESP), susPuntaje: "85.00", createdAt: "t0",
  tareas: [{ tarea: "T1", completada: true, errores: 0 }],
  hallazgos: [{ id: "h1", sesionId: ID, descripcion: "Boton", pantalla: "Ordenes", prioridad: "CRITICA", enBacklog: true, resuelto: false }],
  ...extra,
});

const nueva = (extra: Record<string, unknown> = {}) => ({
  participante: "Ana", perfil: null, susRespuestas: RESP, observaciones: "ok",
  tareas: [{ tarea: "T1", completada: true, errores: 0 }],
  hallazgos: [{ descripcion: "Critico", prioridad: "CRITICA" }, { descripcion: "Menor", pantalla: "X", prioridad: "BAJA" }],
  ...extra,
}) as any;

describe("usabilidad: lectura", () => {
  it("presenta la sesion con puntaje, nivel SUS y fecha en texto", async () => {
    col("UsabilidadSesiones")["first"].mockResolvedValue(sesionDb());
    const s = await S.getSesionById(ID);
    expect(s).toMatchObject({ id: ID, fechaSesion: "2026-11-10", susPuntaje: 85, susNivel: "EXCELENTE", susRespuestas: RESP });
    expect(s.hallazgos[0]).toMatchObject({ prioridad: "CRITICA", enBacklog: true });
  });

  it("404 si la sesion no existe", async () => {
    expect(await status(S.getSesionById(ID))).toBe(404);
  });

  it("listSesiones ordena de la mas reciente a la mas antigua", async () => {
    col("UsabilidadSesiones")["all"].mockResolvedValue([
      sesionDb({ id: "a", fechaSesion: Temporal.PlainDate.from("2026-01-01") }),
      sesionDb({ id: "b", fechaSesion: Temporal.PlainDate.from("2026-06-01") }),
    ]);
    expect((await S.listSesiones()).map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("usabilidad: createSesion", () => {
  beforeEach(() => {
    col("UsabilidadSesiones")["create"].mockResolvedValue({ id: ID });
    col("UsabilidadSesiones")["first"].mockResolvedValue(sesionDb());
  });

  it("guarda puntaje SUS calculado, tareas y hallazgos; solo los criticos entran al backlog", async () => {
    const r = await S.createSesion(nueva({ fechaSesion: "2026-11-01" }), "u1");
    const data = col("UsabilidadSesiones")["create"].mock.calls[0]![0];
    expect(data).toMatchObject({ participante: "Ana", perfil: null, susPuntaje: "85.00", creadaPor: "u1", observaciones: "ok" });
    expect(data.fechaSesion.toString()).toBe("2026-11-01");
    expect(JSON.parse(data.susRespuestas)).toEqual(RESP);
    expect(col("UsabilidadTareas")["createAll"].mock.calls[0]![0]).toEqual([
      { sesionId: ID, tarea: "T1", completada: true, errores: 0, observaciones: null },
    ]);
    const hallazgos = col("UsabilidadHallazgos")["createAll"].mock.calls[0]![0];
    expect(hallazgos.map((x: any) => [x.prioridad, x.enBacklog, x.pantalla])).toEqual([["CRITICA", true, null], ["BAJA", false, "X"]]);
    expect(r.id).toBe(ID);
  });

  it("sin fecha usa hoy; sin hallazgos ni creador no escribe hallazgos", async () => {
    await S.createSesion(nueva({ hallazgos: [], observaciones: undefined }));
    const data = col("UsabilidadSesiones")["create"].mock.calls[0]![0];
    expect(data.fechaSesion).toBeInstanceOf(Temporal.PlainDate);
    expect(data).toMatchObject({ creadaPor: null, observaciones: null });
    expect(col("UsabilidadHallazgos")["createAll"]).not.toHaveBeenCalled();
  });
});

describe("usabilidad: borrar y actualizar hallazgo", () => {
  it("deleteSesion borra la sesion existente y 404 si no existe", async () => {
    expect(await status(S.deleteSesion(ID))).toBe(404);
    col("UsabilidadSesiones")["first"].mockResolvedValue(sesionDb());
    await S.deleteSesion(ID);
    expect(col("UsabilidadSesiones")["delete"]).toHaveBeenCalled();
    expect(wheres("UsabilidadSesiones")).toContainEqual({ id: ID });
  });

  it("updateHallazgo guarda los cambios con updatedAt y devuelve la sesion", async () => {
    col("UsabilidadHallazgos")["first"].mockResolvedValue({ id: "h1", sesionId: ID });
    col("UsabilidadSesiones")["first"].mockResolvedValue(sesionDb());
    const r = await S.updateHallazgo("h1", { resuelto: true });
    const data = col("UsabilidadHallazgos")["update"].mock.calls[0]![0];
    expect(data.resuelto).toBe(true);
    expect(data.updatedAt).toBeInstanceOf(Temporal.Instant);
    expect(r.id).toBe(ID);
  });

  it("updateHallazgo da 404 si el hallazgo no existe", async () => {
    expect(await status(S.updateHallazgo("h1", { resuelto: true }))).toBe(404);
    expect(col("UsabilidadHallazgos")["update"]).not.toHaveBeenCalled();
  });
});

describe("usabilidad: resumen e informe", () => {
  beforeEach(() => {
    col("UsabilidadSesiones")["all"].mockResolvedValue([
      sesionDb(),
      sesionDb({ id: "b", participante: "Luis", fechaSesion: Temporal.PlainDate.from("2026-11-01"), tareas: [{ tarea: "T1", completada: false, errores: 2 }], hallazgos: [] }),
    ]);
  });

  it("getResumen agrega las sesiones", async () => {
    const r = (await S.getResumen()) as any;
    expect(r.totalSesiones ?? r.sesiones).toBe(2);
  });

  it("getInformeMarkdown genera un informe con los participantes", async () => {
    const md = await S.getInformeMarkdown();
    expect(md).toContain("Ana");
    expect(md).toContain("Luis");
  });
});

describe("usabilidad: controlador", () => {
  it("tareas base no necesita base de datos", async () => {
    const { res } = await llamar(C.getTareasBaseController);
    expect(res.json.mock.calls[0]![0].data.tareas.length).toBeGreaterThan(0);
  });

  it("listar, obtener, crear (201), eliminar (204) y actualizar hallazgo", async () => {
    col("UsabilidadSesiones")["all"].mockResolvedValue([sesionDb()]);
    col("UsabilidadSesiones")["first"].mockResolvedValue(sesionDb());
    col("UsabilidadSesiones")["create"].mockResolvedValue({ id: ID });
    col("UsabilidadHallazgos")["first"].mockResolvedValue({ id: "h1", sesionId: ID });
    expect((await llamar(C.listSesionesController)).res.json.mock.calls[0]![0].data).toHaveLength(1);
    expect((await llamar(C.getSesionController, { params: { id: ID } })).res.json.mock.calls[0]![0].data.id).toBe(ID);
    const crear = await llamar(C.createSesionController, { body: nueva(), user: { id: "u1" } });
    expect(crear.res.status).toHaveBeenCalledWith(201);
    const del = await llamar(C.deleteSesionController, { params: { id: ID } });
    expect(del.res.status).toHaveBeenCalledWith(204);
    expect(del.res.send).toHaveBeenCalled();
    const upd = await llamar(C.updateHallazgoController, { params: { id: "h1" }, body: { resuelto: true } });
    expect(upd.res.json.mock.calls[0]![0].data.id).toBe(ID);
  });

  it("resumen e informe (descarga markdown)", async () => {
    col("UsabilidadSesiones")["all"].mockResolvedValue([sesionDb()]);
    expect((await llamar(C.getResumenController)).res.json).toHaveBeenCalled();
    const { res } = await llamar(C.getInformeController);
    expect(res.type).toHaveBeenCalledWith("text/markdown; charset=utf-8");
    expect(res.set).toHaveBeenCalledWith("Content-Disposition", 'attachment; filename="informe-usabilidad.md"');
    expect(res.send.mock.calls[0]![0]).toContain("Ana");
  });

  it("errores del servicio llegan a next", async () => {
    const { next } = await llamar(C.getSesionController, { params: { id: ID } });
    expect(next.mock.calls[0]![0].statusCode).toBe(404);
  });
});
