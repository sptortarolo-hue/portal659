import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, "..", ".env.local");
const envRaw = readFileSync(envPath, "utf-8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=ar`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Portal659/1.0 (geocoding vendors)" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

function parseIntersection(address) {
  const match = address.match(/Calle\s+(\d+)\s+[yY]\s+(\d+)/i);
  if (!match) return null;
  const street1 = parseInt(match[1]);
  const street2 = parseInt(match[2]);
  return { street1, street2 };
}

const LA_PLATA_CENTER = { lat: -34.921, lng: -57.954 };
const SICARDI_OFFSET = { lat: -34.987, lng: -57.856 };
const GARIBALDI_OFFSET = { lat: -34.990, lng: -57.851 };

function getApproxCoords(street1, street2, neighborhood) {
  const base = neighborhood === "garibaldi" ? GARIBALDI_OFFSET : SICARDI_OFFSET;
  
  // Calle 659 is the horizontal street (y-axis), around -34.989
  // Numbered streets (Calle 22, 49, etc.) are the vertical axis
  if (street1 === 659) {
    return {
      lat: base.lat - 0.002 + (street2 - 22) * 0.00022,
      lng: base.lng + (street2 % 10) * 0.0003,
    };
  }
  
  const latOffset = (street2 - 20) * 0.00022;
  const lngOffset = (street1 - 48) * 0.00035;
  return {
    lat: base.lat + latOffset,
    lng: base.lng + lngOffset,
  };
}

async function main() {
  const { data: vendors, error } = await supabase
    .from("vendors")
    .select("id, store_name, address, neighborhood")
    .or("address.not.is.null,location.not.is.null");

  if (error) {
    console.error("Error fetching vendors:", error.message);
    process.exit(1);
  }

  console.log(`Found ${vendors.length} vendors to geocode\n`);

  let geocoded = 0;
  let failed = 0;

  for (const v of vendors) {
    const address = v.address || "";
    if (!address.trim()) {
      console.log(`⏭  ${v.store_name} — sin dirección`);
      failed++;
      continue;
    }

    // If address is vague (e.g. "Sicardi y alrededores"), use approximate center
    if (address.toLowerCase().includes("alrededores") || address.toLowerCase().includes("centro")) {
      const approx = v.neighborhood === "garibaldi" ? GARIBALDI_OFFSET : SICARDI_OFFSET;
      const { error: updateError } = await supabase
        .from("vendors")
        .update({ lat: approx.lat, lng: approx.lng })
        .eq("id", v.id);
      console.log(`📐 ${v.store_name} — approx center`);
      geocoded++;
      await sleep(1100);
      continue;
    }

    const query = address;
    process.stdout.write(`🔍 ${v.store_name} — "${address}"... `);

    try {
      let coords = null;

      // Try 1: Full address with La Plata
      coords = await geocode(`${address}, La Plata, Buenos Aires, Argentina`);
      
      // Try 2: Just the intersection without neighborhood
      if (!coords) {
        const parsed = parseIntersection(address);
        if (parsed) {
          coords = await geocode(`Calle ${parsed.street1} y ${parsed.street2}, La Plata, Argentina`);
        }
      }

      // Try 3: Just street names
      if (!coords) {
        const parsed = parseIntersection(address);
        if (parsed) {
          coords = await geocode(`${parsed.street1} y ${parsed.street2}, La Plata, Argentina`);
        }
      }

      // Try 4: Approximate grid position (La Plata uses a grid system)
      if (!coords) {
        const parsed = parseIntersection(address);
        if (parsed) {
          coords = getApproxCoords(parsed.street1, parsed.street2, v.neighborhood);
          console.log(`📐 approx grid`);
        }
      }

      // Verify coords are within Sicardi/Garibaldi bounding box
      if (coords) {
        const inBounds = coords.lat >= -34.995 && coords.lat <= -34.980
                      && coords.lng >= -57.865 && coords.lng <= -57.845;
        if (!inBounds) {
          const parsed = parseIntersection(address);
          if (parsed) {
            coords = getApproxCoords(parsed.street1, parsed.street2, v.neighborhood);
            console.log(`📐 corrected to grid (was outside barrio)`);
          }
        }
      }

      if (coords) {
        const { error: updateError } = await supabase
          .from("vendors")
          .update({ lat: coords.lat, lng: coords.lng })
          .eq("id", v.id);

        if (updateError) {
          console.log(`❌ DB error: ${updateError.message}`);
          failed++;
        } else {
          console.log(`✅ ${coords.lat}, ${coords.lng}`);
          geocoded++;
        }
      } else {
        console.log(`❌ no results`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ ${err.message}`);
      failed++;
    }

    await sleep(1100);
  }

  console.log(`\n📊 Results: ${geocoded} geocoded, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
