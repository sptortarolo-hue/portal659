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

export type PlanSlug = "gratuito" | "pedidos" | "gestion";

export type PlanStatus = "gratuito" | "trial" | "active" | "expired" | "cancelled";

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
};

export type Plan = {
  id: string;
  slug: PlanSlug;
  name: string;
  description: string | null;
  price_monthly: number;
  max_products: number | null;
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
  position: number;
  created_at: string;
};

export type ModifierOption = {
  label: string;
  price_mod: number;
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
  services_list: string | null;
  service_area: string | null;
  free_estimate: boolean | null;
  accepting_quotes: boolean;
  verified: boolean;
  featured?: boolean;
  hours: string | null;
  location: string | null;
  address: string | null;
  description: string | null;
  image_url: string | null;
  logo_url: string | null;
  prep_time_min: number | null;
  urgent_enabled: boolean;
  is_admin: boolean;
  printer_ip: string | null;
  printer_port: number | null;
  paper_size: string | null;
  auto_print: boolean;
  print_mode?: "server" | "app" | null;
  print_token?: string | null;
  last_print_at?: string | null;
  last_print_ok?: boolean | null;
  last_print_error?: string | null;
  lat?: number | null;
  lng?: number | null;
  transfer_alias?: string | null;
  transfer_cbu?: string | null;
  transfer_holder?: string | null;
  transfer_qr_url?: string | null;
  block_unpaid_orders?: boolean;
  plan_id: string | null;
  plan_status: PlanStatus;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
};

export type Booking = {
  id: string;
  product_id: string;
  customer_id: string;
  vendor_id: string;
  product_name: string | null;
  booking_date: string;
  booking_time: string;
  notes: string | null;
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
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
  payment_method: "whatsapp" | "efectivo" | "transferencia";
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
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  product_id?: string;
  name: string;
  price: number;
  qty: number;
  modifiers?: string[];
};

export type OrderStatusLog = {
  id: string;
  order_id: string;
  status: OrderStatus;
  created_at: string;
};
