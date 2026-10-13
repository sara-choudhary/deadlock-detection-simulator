import ThemeToggle from "@/components/ThemeToggle";

export default function Masthead() {
  return (
    <header className="border-b border-ink">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="font-serif text-lg font-semibold leading-tight tracking-tight">
            Deadlock Detection Simulator
          </p>
          <p className="font-mono text-[0.7rem] uppercase tracking-widest text-soft">
            Operating Systems · Multiple-instance detection
          </p>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}