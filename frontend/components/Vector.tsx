import { resourceNames } from "@/lib/inputs";

type Props = {
  values: number[];
  label: string; // read by screen readers, for example "Work before this scan"
};

// One vector shown as a small labelled row: R1 R2 R3 over the numbers.
// The numbers come from the server; nothing is calculated here.
export default function Vector({ values, label }: Props) {
  const names = resourceNames(values.length);
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="border-collapse font-mono text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {names.map((name) => (
              <th key={name} scope="col" className="px-2 pb-0.5 text-center text-xs font-normal text-soft">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {values.map((value, i) => (
              <td key={names[i]} className="min-w-9 border border-soft/70 px-2 py-1 text-center tabular-nums">
                {value}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}