export type Neighborhood = {
  slug: string;
  name: string;
  lat: number;
  lng: number;
};

export type Vertical =
  | "gastronomia"
  | "comercio"
  | "servicio"
  | "moda"
  | "salud"
  | "otro";

export type PlanSlug = "gratuito" | "pedidos" | "gestion" | "oficios";

export type PlanStatus = "gratuito" | "trial" | "active" | "expired" | "cancelled" | "preview";

export type PlanFeatures = {
  info: boolean;
  cart: boolean;
  emits_orders: boolean;
  mp_payments: boolean;
  kds: boolean;
  printer: boolean;
  variants: boolean;
  modifiers: boolean;
  urgent: boolean;
  pos: boolean;
  mesas: boolean;
  reviews_manage: boolean;
  analytics_days: number;
  priority: boolean;
  /** Módulo Recetas/escandallo (gastronomía, plan Gestión integral). */
  recipes: boolean;
  /** Libro de clientes CRM (gastronomía, plan Gestión integral). */
  crm: boolean;
  /** Responder presupuestos con precio (servicios, plan Oficios). */
  quotes_respond: boolean;
  /** Cobrar seña por Mercado Pago en presupuestos/turnos (servicios, Oficios). */
  deposits: boolean;
};

export type Plan = {
  id: string;
  slug: PlanSlug;
  name: string;
  description: string | null;
  price_monthly: number;
  max_products: number | null;
  max_orders_month: number | null;
  /** Tope mensual de presupuestos + turnos (servicios). NULL = ilimitado. Puede faltar si la migración aún no se aplicó. */
  max_quotes_month?: number | null;
  features: PlanFeatures;
  badge: string | null;
  popular: boolean;
  sort: number;
  created_at: string;
  promo_price: number | null;
  promo_months: number | null;
  promo_ends_at: string | null;
  promo_label: string | null;
};

export type VendorSubscription = {
  id: string;
  vendor_id: string;
  plan_id: string;
  status: "trial" | "active" | "expired" | "cancelled";
  started_at: string;
  current_period_start: string;
  current_period_end: string | null;
  note: string | null;
  payment_method: string | null;
  amount: number | null;
  paid_at: string | null;
  created_at: string;
};

export type VendorTable = {
  id: string;
  vendor_id: string;
  name: string;
  capacity: number;
  status: "libre" | "ocupada" | "reservada";
  position: number;
  created_at: string;
};

export type OrderChannel = "app" | "mostrador" | "mesa";

export type ProductModifier = {
  id: string;
  product_id: string;
  group_name: string;
  options: ModifierOption[];
  required: boolean;
  max_selections: number;
  /** Mínimo exigible (solo si required). NULL/ausente = legacy (≥1 si required). */
  min_selections?: number | null;
  position: number;
  /** Grupo "Variante": aparece primero y debe elegirse una opción. */
  is_variant?: boolean;
  created_at: string;
};

/** Grupo de modificadores definido una vez (muchos a muchos con productos). */
export type ModifierGroup = {
  id: string;
  vendor_id: string;
  group_name: string;
  options: ModifierOption[];
  required: boolean;
  max_selections: number;
  /** Mínimo exigible (solo si required). NULL = legacy. Puede faltar si la migración aún no se aplicó. */
  min_selections?: number | null;
  is_variant: boolean;
  created_at: string;
  product_ids?: string[];
  products_count?: number;
};

export type ModifierOption = {
  label: string;
  price_mod: number;
  /** Familia opcional para agrupar/filtrar (ej: "Cremas", "Chocolates"). Vive en el JSONB: sin migración. */
  category?: string;
  /** Gusto pausado (ej: se acabó el pistacho): se oculta sin borrarlo. Ausente = disponible. */
  available?: boolean;
};

/** Unidad base de un insumo: peso (g), volumen (ml) o unidad (u). */
export type IngredientUnit = "g" | "ml" | "u";

/** Insumo / materia prima del módulo Recetas (escandallo). */
export type Ingredient = {
  id: string;
  vendor_id: string;
  name: string;
  base_unit: IngredientUnit;
  /** Costo por 1 unidad base, SIN IVA. */
  cost_per_unit: number;
  /** % de merma (0-100). */
  waste_pct: number;
  /** true = elaboración propia con sub-receta en recipes. */
  is_elaborated: boolean;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** Cabecera de receta: un plato de carta (product_id) o un insumo
 *  elaborado (ingredient_id). Exactamente uno de los dos. */
export type Recipe = {
  id: string;
  vendor_id: string;
  product_id: string | null;
  ingredient_id: string | null;
  /** Rinde: porciones (plato) o cantidad en unidad base (sub-receta). */
  portions: number;
  instructions: string | null;
  created_at: string;
  updated_at: string;
};

/** Línea de receta: insumo + cantidad NETA + unidad de la línea. */
export type RecipeItem = {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  qty_net: number;
  unit: string;
  position: number;
  created_at: string;
};

/** Tipo de comprobante de una compra (AR). */
export type ReceiptType =
  | "factura_a"
  | "factura_b"
  | "factura_c"
  | "remito"
  | "ticket"
  | "ninguno";

/** Proveedor del módulo Compras. */
export type Supplier = {
  id: string;
  vendor_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** Compra a proveedor (cabecera). El total es Σ de líneas. */
export type Purchase = {
  id: string;
  vendor_id: string;
  supplier_id: string | null;
  purchased_at: string;
  receipt_type: ReceiptType;
  receipt_number: string | null;
  notes: string | null;
  total: number;
  created_at: string;
  updated_at: string;
};

/** Línea de compra: insumo + cantidad + costo neto por unidad base. */
export type PurchaseItem = {
  id: string;
  purchase_id: string;
  ingredient_id: string;
  qty: number;
  unit: string;
  unit_cost_net: number;
  line_total: number;
  position: number;
  created_at: string;
};

/** Link de receta compartida: otro producto a la venta del mismo batch
 *  (ej. la porción y la torta entera). El costo se deriva con `servings`;
 *  el precio sigue siendo propio de cada producto. */
export type ProductRecipeLink = {
  id: string;
  recipe_id: string;
  product_id: string;
  /** Porciones del batch que representa esta venta. */
  servings: number;
  created_at: string;
};

/** Umbrales del semáforo food-cost (global por comercio). */
export type FoodCostThresholds = {
  warn: number;
  bad: number;
};

export type VendorGallery = {
  id: string;
  vendor_id: string;
  image_url: string;
  caption: string | null;
  position: number;
  created_at: string;
};

export type Product = {
  id: string;
  vendor_id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  neighborhood: string;
  type: "product" | "service" | "food";
  image_url: string | null;
  stock: number | null;
  stock_low_threshold: number | null;
  stock_control?: boolean;
  promo_price: number | null;
  available: boolean;
  featured_today: boolean;
  unit: string | null;
  has_variants?: boolean;
  /** true = la promo de este producto NO recibe el descuento en efectivo. */
  cash_discount_excluded?: boolean;
  /** Se vende de a N unidades (ej: 6). El precio es del paquete. NULL = por unidad. */
  pack_size?: number | null;
  /** Guía de talles por producto (moda): una línea por talle — "M: Pecho 96 cm". NULL = sin guía. */
  size_guide?: string | null;
  created_at: string;
};

export type ProductVariant = {
  id: string;
  product_id: string;
  color: string;
  talle: string;
  price: number;
  promo: number | null;
  stock: number;
  sku: string | null;
  position: number;
  created_at: string;
};

export type ProductImage = {
  id: string;
  product_id: string;
  image_url: string;
  /** Color de variante asociado (moda). NULL = foto general. */
  color?: string | null;
  position: number;
  created_at: string;
};

export type Vendor = {
  id: string;
  user_id: string;
  store_name: string;
  slug: string | null;
  category: string | null;
  vertical: Vertical;
  neighborhood: string | null;
  whatsapp: string | null;
  phone: string | null;
  instagram: string | null;
  facebook: string | null;
  payment_methods: string | null;
  delivery_options: string | null;
  delivery_fee?: number | null;
  free_delivery_min?: number | null;
  services_list: string | null;
  service_area: string | null;
  free_estimate: boolean | null;
  accepting_quotes: boolean;
  verified: boolean;
  featured?: boolean;
  hours: string | null;
  /** Sobrescritura manual de apertura: null=por horarios, true=abierto, false=cerrado. */
  open_override?: boolean | null;
  location: string | null;
  address: string | null;
  description: string | null;
  image_url: string | null;
  logo_url: string | null;
  prep_time_min: number | null;
  urgent_enabled: boolean;
  /** % de recargo en urgencias (servicios, plan Oficios). NULL = sin recargo. */
  urgent_surcharge_pct?: number | null;
  /** % de seña por defecto sobre el cotizado (servicios, Oficios). NULL = 30. */
  deposit_default_pct?: number | null;
  is_admin: boolean;
  printer_ip: string | null;
  printer_port: number | null;
  paper_size: string | null;
  auto_print: boolean;
  print_mode?: "server" | "app" | null;
  /** Mercado Pago multi-market (OAuth por comercio). §5 docs/mp-multimarket-plan.md */
  mp_user_id?: number | null;
  mp_access_token?: string | null;
  mp_refresh_token?: string | null;
  mp_public_key?: string | null;
  mp_expires_at?: string | null;
  mp_connected_at?: string | null;
  print_token?: string | null;
  last_print_at?: string | null;
  last_print_ok?: boolean | null;
  last_print_error?: string | null;
  print_logo?: boolean | null;
  print_address?: boolean | null;
  print_phone?: boolean | null;
  print_social?: boolean | null;
  lat?: number | null;
  lng?: number | null;
  transfer_alias?: string | null;
  transfer_cbu?: string | null;
  transfer_holder?: string | null;
  transfer_qr_url?: string | null;
  block_unpaid_orders?: boolean;
  /** Umbrales del semáforo food-cost (NULL = defaults 30/35). */
  food_cost_warn?: number | null;
  food_cost_bad?: number | null;
  /** Opt-out de venta online: false = solo contacto aunque el plan traiga carrito. */
  accepts_online_orders?: boolean | null;
  /** % de descuento en efectivo (NULL/0 = sin descuento). Requiere Efectivo en payment_methods. */
  cash_discount_pct?: number | null;
  plan_id: string | null;
  plan_status: PlanStatus;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  /** Token secreto del link de preview compartible. NULL = sin preview compartido. */
  preview_token?: string | null;
  /** Expiración opcional del token de preview. NULL = sin expiración. */
  preview_token_expires_at?: string | null;
  /** Solicitud de publicación pendiente de aprobación del admin. */
  publish_requested_at?: string | null;
  visible?: boolean | null;
  created_at: string;
};

export type Booking = {
  id: string;
  product_id: string;
  customer_id: string;
  vendor_id: string;
  product_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  booking_date: string;
  booking_time: string;
  notes: string | null;
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
};

export type Customer = {
  id: string;
  vendor_id: string;
  /** E.164 sin "+" (549...) o "lid:<id>" para chats del bot sin teléfono real. */
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  last_order_at: string | null;
  total_orders: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
};

export type Quote = {
  id: string;
  vendor_id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string | null;
  description: string;
  preferred_date: string | null;
  preferred_time: string | null;
  status: "pending" | "responded" | "accepted" | "cancelled";
  vendor_notes: string | null;
  created_at: string;
};

export type Review = {
  id: string;
  vendor_id: string;
  product_id: string | null;
  customer_id: string | null;
  customer_name: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  reply_by: string | null;
  replied_at: string | null;
  created_at: string;
};

export type OrderStatus = "new" | "confirmed" | "preparing" | "ready" | "sent" | "completed" | "cancelled";

export type Order = {
  id: string;
  vendor_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  method: "pickup" | "delivery";
  payment_method: "whatsapp" | "efectivo" | "transferencia" | "mercadopago" | "tarjeta" | "mixto";
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  notes: string | null;
  modification_notes: string | null;
  estimated_minutes: number | null;
  channel: OrderChannel;
  table_id: string | null;
  paid_at: string | null;
  payment_status?: "paid" | "pending";
  pickup_number?: number | null;
  track_token?: string | null;
  /** Costo de envío del pedido (si aplica). */
  delivery_cost?: number | null;
  /** Número legible del pedido (ticket). */
  order_number?: string | null;
  /** Descuento en efectivo aplicado (detalle para ticket/WhatsApp). */
  cash_discount?: number | null;
    /** % de descuento en efectivo aplicado. */
    cash_pct?: number | null;
    /** Descuento por volumen aplicado (detalle para ticket/WhatsApp). */
    volume_discount?: number | null;
  /** Pedido de prueba (modo preview). true = no cuenta en topes/métricas/ingresos. */
  is_preview?: boolean;
  /** Comprobante de transferencia (imagen/PDF) que llegó por WhatsApp al bot. */
  transfer_proof_url?: string | null;
  /** Apartado/seña (moda): reserva con pago parcial + vencimiento. */
  is_apartado?: boolean | null;
  /** Monto de la seña acordada. */
  deposit_amount?: number | null;
  /** % de seña sobre el total. */
  deposit_pct?: number | null;
  /** Estado de la seña: 'pending' (link generado) | 'paid' (cobrada) | null (sin registrar). */
  deposit_status?: "pending" | "paid" | null;
  /** Vencimiento del apartado (saldo pendiente). */
  deposit_due_at?: string | null;
  /** Cuándo se cobró la seña. */
  deposit_paid_at?: string | null;
  /** Cuándo se cobró el saldo (pedido totalmente pago). */
  remainder_paid_at?: string | null;
  /** ID del pago de Mercado Pago (seña de apartado o pedido online). */
  mp_payment_id?: string | null;
  created_at: string;
  updated_at: string;
  /** Momento en que el pedido se cerró (completed/cancelled). Frena el cronómetro. */
  closed_at?: string | null;
};

export type OrderItem = {
  product_id?: string;
  /** Variante (moda: color+talle). Permite descontar/reponer stock. */
  variant_id?: string;
  name: string;
  /** Precio de la UNIDAD (mods incluidos); con pack: precio del PAQUETE completo. */
  price: number;
  qty: number;
  /** Pack (ej: 6): qty es múltiplo y la línea = price × (qty/pack_size). */
  pack_size?: number;
  modifiers?: string[];
  requires_prep?: boolean;
};

export type OrderStatusLog = {
  id: string;
  order_id: string;
  status: OrderStatus;
  created_at: string;
};
