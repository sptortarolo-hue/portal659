export type Neighborhood = {
  slug: string;
  name: string;
  lat: number;
  lng: number;
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
  available: boolean;
  created_at: string;
};

export type Vertical = "gastronomia" | "almacen" | "servicio" | "otro";

export type Vendor = {
  id: string;
  user_id: string;
  store_name: string;
  slug: string | null;
  category: string | null;
  vertical: Vertical;
  neighborhood: string | null;
  whatsapp: string | null;
  accepting_quotes: boolean;
  verified: boolean;
  hours: string | null;
  location: string | null;
  address: string | null;
  description: string | null;
  image_url: string | null;
  logo_url: string | null;
  created_at: string;
};

export type Booking = {
  id: string;
  product_id: string;
  customer_id: string;
  vendor_id: string;
  booking_date: string;
  booking_time: string;
  notes: string | null;
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
};

export type Quote = {
  id: string;
  product_id: string;
  customer_id: string;
  vendor_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  details: string | null;
  status: "pending" | "responded" | "accepted";
  created_at: string;
};