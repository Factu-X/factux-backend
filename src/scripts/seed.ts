import { db } from "../prisma/db.js";
import { nullableVarchar, varchar } from "../shared/prisma-types.js";
import {
  createCatalogoItem,
  listCatalogo,
  updateCatalogoItem,
} from "../modules/catalogo/catalogo.service.js";
import type { CreateCatalogoItemInput } from "../modules/catalogo/catalogo.schemas.js";
import { createCliente, listClientes, updateCliente } from "../modules/clientes/clientes.service.js";
import type { CreateClienteInput } from "../modules/clientes/clientes.schemas.js";
import {
  createMotocicleta,
  listMotocicletasByCliente,
  updateMotocicleta,
} from "../modules/motocicletas/motocicletas.service.js";
import type { CreateMotocicletaInput } from "../modules/motocicletas/motocicletas.schemas.js";
import { createOrden, listOrdenes, updateOrden } from "../modules/ordenes/ordenes.service.js";
import { createFacturaFromOrden, listFacturas } from "../modules/facturas/facturas.service.js";

const seedEmpresa = async () => {
  const data = {
    singleton: true,
    nit: varchar<20>("900123456"),
    digitoVerificacion: nullableVarchar<1>("7"),
    razonSocial: varchar<200>("FactuX Moto Center"),
    direccion: nullableVarchar<250>("Calle 10 #20-30"),
    telefono: nullableVarchar<30>("3001234567"),
    email: nullableVarchar<200>("contacto@factux-demo.local"),
    regimenFiscal: nullableVarchar<150>("Responsable de IVA"),
  };

  const existing = await db.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();

  if (existing) {
    await db.orm.public.ConfiguracionEmpresa.where({ id: existing.id }).update(data);
    return;
  }

  await db.orm.public.ConfiguracionEmpresa.create(data);
};

const upsertCliente = async (input: CreateClienteInput) => {
  const matches = await listClientes({ search: input.numeroIdentificacion });
  const existing = matches.find(
    (cliente) => cliente.numeroIdentificacion === input.numeroIdentificacion,
  );

  if (existing) {
    return updateCliente(existing.id, input);
  }

  return createCliente(input);
};

const upsertMotocicleta = async (clienteId: string, input: CreateMotocicletaInput) => {
  const existing = (await listMotocicletasByCliente(clienteId)).find(
    (motocicleta) => motocicleta.placa.toUpperCase() === input.placa.toUpperCase(),
  );

  if (existing) {
    return updateMotocicleta(existing.id, input);
  }

  return createMotocicleta(clienteId, input);
};

const upsertCatalogoItem = async (input: CreateCatalogoItemInput) => {
  const existing = (await listCatalogo({ search: input.codigo })).find(
    (item) => item.codigo === input.codigo,
  );

  if (existing) {
    return updateCatalogoItem(existing.id, input);
  }

  return createCatalogoItem(input);
};

const seedFacturaDemo = async (clienteId: string, motocicletaId: string, catalogoItems: Awaited<ReturnType<typeof upsertCatalogoItem>>[]) => {
  const existingFactura = (await listFacturas({ search: "FV-" })).find(
    (factura) => factura.numero === "FV-000001",
  );

  if (existingFactura) {
    return;
  }

  const existingOrden = (await listOrdenes({})).find((orden) => orden.numero.startsWith("OS-"));
  const servicio = catalogoItems.find((item) => item.tipo === "SERVICIO");
  const repuesto = catalogoItems.find((item) => item.tipo === "REPUESTO");

  if (!servicio || !repuesto) {
    return;
  }

  let ordenId = existingOrden?.id;

  if (!ordenId) {
    const creada = await createOrden({
      clienteId,
      motocicletaId,
      kilometrajeIngreso: 25000,
      motivoIngreso: "Mantenimiento preventivo demo",
      observaciones: "Orden demo para facturacion interna",
      estado: "EN_PROCESO",
      detalles: [
        { itemCatalogoId: servicio.id, cantidad: 1 },
        { itemCatalogoId: repuesto.id, cantidad: 1 },
      ],
    });
    await updateOrden(creada.id, { estado: "FINALIZADA" });
    ordenId = creada.id;
  }

  await createFacturaFromOrden({
    ordenId,
    formaPago: "CONTADO",
  });
};

const clientes: CreateClienteInput[] = [
  {
    tipoIdentificacion: "CC",
    numeroIdentificacion: "1020304050",
    nombreRazonSocial: "Carlos Perez",
    direccion: "Carrera 15 #45-12",
    telefono: "3105551000",
    email: "carlos.perez@example.com",
    activo: true,
  },
  {
    tipoIdentificacion: "NIT",
    numeroIdentificacion: "901222333",
    digitoVerificacion: "5",
    nombreRazonSocial: "Repuestos La Ruta SAS",
    direccion: "Avenida 7 #80-20",
    telefono: "6015553344",
    email: "compras@laruta.example.com",
    activo: true,
  },
];

const catalogo: CreateCatalogoItemInput[] = [
  {
    codigo: "SERV-ACEITE",
    nombre: "Cambio de aceite",
    descripcion: "Cambio de aceite para motocicleta",
    tipo: "SERVICIO",
    precioVenta: 35000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
  {
    codigo: "SERV-REV-GRAL",
    nombre: "Revision general",
    descripcion: "Revision preventiva de sistemas principales",
    tipo: "SERVICIO",
    precioVenta: 80000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
  {
    codigo: "SERV-FRENOS",
    nombre: "Cambio de pastillas de freno",
    tipo: "SERVICIO",
    precioVenta: 45000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
  {
    codigo: "SERV-MANT-PREV",
    nombre: "Mantenimiento preventivo",
    tipo: "SERVICIO",
    precioVenta: 120000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
  {
    codigo: "REP-ACEITE-10W40",
    nombre: "Aceite 10W40",
    tipo: "REPUESTO",
    precioVenta: 42000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
  {
    codigo: "REP-FILTRO-ACEITE",
    nombre: "Filtro de aceite",
    tipo: "REPUESTO",
    precioVenta: 18000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
  {
    codigo: "REP-PASTILLAS-FRENO",
    nombre: "Pastillas de freno",
    tipo: "REPUESTO",
    precioVenta: 65000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
  {
    codigo: "REP-BUJIA",
    nombre: "Bujia",
    tipo: "REPUESTO",
    precioVenta: 16000,
    tratamientoIva: "GRAVADO",
    tarifaIva: 19,
    activo: true,
  },
];

const seed = async () => {
  await seedEmpresa();

  const [clienteNatural, clienteEmpresa] = await Promise.all(clientes.map(upsertCliente));

  const motoNatural = await upsertMotocicleta(clienteNatural.id, {
    placa: "ABC12D",
    marca: "Yamaha",
    modelo: "FZ 2.0",
    anio: 2021,
    cilindraje: 150,
    kilometrajeActual: 18500,
    activa: true,
  });

  await upsertMotocicleta(clienteNatural.id, {
    placa: "XYZ34E",
    marca: "Honda",
    modelo: "CB 190R",
    anio: 2020,
    cilindraje: 184,
    kilometrajeActual: 24100,
    activa: true,
  });

  await upsertMotocicleta(clienteEmpresa.id, {
    placa: "RUT56F",
    marca: "Suzuki",
    modelo: "GN 125",
    anio: 2019,
    cilindraje: 125,
    kilometrajeActual: 32700,
    activa: true,
  });

  const catalogoItems = await Promise.all(catalogo.map(upsertCatalogoItem));

  await seedFacturaDemo(clienteNatural.id, motoNatural.id, catalogoItems);

  const totalClientes = await db.orm.public.Clientes.aggregate((aggregate) => ({
    count: aggregate.count(),
  }));
  const totalCatalogo = await db.orm.public.ItemsCatalogo.aggregate((aggregate) => ({
    count: aggregate.count(),
  }));

  console.log("Seed completado", {
    clientes: totalClientes.count,
    catalogo: totalCatalogo.count,
  });
};

const main = async () => {
  try {
    await seed();
  } finally {
    await db.close();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
