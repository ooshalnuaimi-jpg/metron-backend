/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: { outputFileTracingIncludes: { "/desk": ["./public/metron.html"] } },
  async headers() { return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Referrer-Policy", value: "no-referrer" }] }]; },
};
