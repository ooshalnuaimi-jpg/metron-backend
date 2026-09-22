export const metadata = { title: "METRON · Global Market Intelligence" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en-GB"><body style={{ margin: 0, background: "#050505", color: "#F4F4F2", fontFamily: "Geist, system-ui, sans-serif" }}>{children}</body></html>);
}
