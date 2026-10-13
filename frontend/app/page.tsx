import InputWorkspace from "@/components/InputWorkspace";
import Masthead from "@/components/Masthead";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
      >
        Skip to the main content
      </a>

      <Masthead />

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 sm:px-6">
        {/* Introduction */}
        <section
          aria-labelledby="intro-title"
          className="grid gap-4 border-b border-rule py-8 md:grid-cols-12 md:gap-8 md:py-10"
        >
          <p className="font-mono text-xs uppercase tracking-widest text-soft md:col-span-3">
            00 &mdash; Introduction
          </p>

          <div className="md:col-span-9">
            <h1
              id="intro-title"
              className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"
            >
              Deadlock Detection
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed">
              Describe what each process holds and what it is still waiting for. The server runs
              the standard detection algorithm for resource types with several identical
              instances, then shows which processes can finish, which cannot, and why, one scan at
              a time.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-soft">
              This detects deadlock in a snapshot you describe. It is not the Banker&apos;s
              algorithm, which decides whether granting a request would be safe.
            </p>
          </div>
        </section>

        <InputWorkspace />
      </main>
    </>
  );
}
