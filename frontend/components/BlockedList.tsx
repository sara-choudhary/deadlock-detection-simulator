import Vector from "@/components/Vector";
import type { DetectResponse } from "@/lib/types";

const cell = "border border-soft/70 px-3 py-1";

// One entry for each deadlocked process, using the server's own explanation
// and shortage figures. The processes are listed in the order the server
// gives them in `deadlocked_processes`.
export default function BlockedList({ result }: { result: DetectResponse }) {
  return (
    <section aria-labelledby="blocked-title" className="mt-10">
      <h3 id="blocked-title" className="font-serif text-xl font-semibold tracking-tight">
        Why these processes are stuck
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-soft">
        Each comparison uses the final Work vector: the resources that were free when the scans
        stopped.
      </p>

      <div className="mt-4 space-y-6">
        {result.deadlocked_processes.map((name) => {
          const info = result.blocked_explanations[name];
          return (
            <article key={name} className="border-l-4 border-accent pl-4">
              <h4 className="text-base font-semibold text-accent">
                <span aria-hidden="true">✕ </span>
                <span className="font-mono">{name}</span> cannot finish
              </h4>
              <p className="mt-1 max-w-2xl text-sm">{info.explanation}</p>

              {info.shortages.length > 0 && (
                <div className="mt-3 max-w-full overflow-x-auto">
                  <table className="border-collapse font-mono text-sm">
                    <caption className="sr-only">{`Shortages for ${name}`}</caption>
                    <thead>
                      <tr>
                        {["Resource", "Needs", "Available", "Short by"].map((heading) => (
                          <th key={heading} scope="col" className={`${cell} text-left text-xs font-normal text-soft`}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {info.shortages.map((shortage) => (
                        <tr key={shortage.resource}>
                          <th scope="row" className={`${cell} text-left font-semibold`}>
                            {shortage.resource}
                          </th>
                          <td className={`${cell} tabular-nums`}>{shortage.requested}</td>
                          <td className={`${cell} tabular-nums`}>{shortage.available}</td>
                          <td className={`${cell} font-semibold tabular-nums text-accent`}>{shortage.shortfall}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-wider text-soft">Holds now</p>
                  <Vector values={info.allocation} label={`${name} holds now`} />
                </div>
                <div>
                  <p className="font-mono text-xs uppercase tracking-wider text-soft">Still requests</p>
                  <Vector values={info.request} label={`${name} still requests`} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}