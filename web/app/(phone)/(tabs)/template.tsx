/** Every screen slides in rather than just appearing. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in relative min-h-full">{children}</div>;
}
