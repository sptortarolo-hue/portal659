export async function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem("sb-access-token");
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
