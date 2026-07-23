import {
  getFieldSupport,
  messageFieldLabels,
  messageFields,
  type ProviderKey,
} from "@/lib/compare";
import { type Provider } from "@/lib/providers";

function SupportMark({ supported }: { supported: boolean }) {
  return supported ? (
    <span aria-label="Supported" className="text-fd-primary">
      ✓
    </span>
  ) : (
    <span aria-label="Not supported" className="text-fd-muted-foreground">
      —
    </span>
  );
}

export function CompareTable({ columns }: { columns: { key: ProviderKey; name: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-fd-border text-left">
            <th className="py-2 pr-4 font-medium text-fd-muted-foreground">Message field</th>
            {columns.map((column) => (
              <th key={column.key} className="py-2 pr-4 font-medium">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {messageFields.map((field) => (
            <tr key={field} className="border-b border-fd-border">
              <td className="py-2 pr-4 text-fd-muted-foreground">{messageFieldLabels[field]}</td>
              {columns.map((column) => (
                <td key={column.key} className="py-2 pr-4">
                  <SupportMark supported={getFieldSupport(column.key)[field] === true} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FullCompareTable({ providers: allProviders }: { providers: readonly Provider[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-fd-border text-left">
            <th className="py-2 pr-4 font-medium text-fd-muted-foreground">Provider</th>
            {messageFields.map((field) => (
              <th key={field} className="px-2 py-2 font-medium" title={messageFieldLabels[field]}>
                {field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allProviders.map((provider) => {
            const support = getFieldSupport(provider.key as ProviderKey);
            return (
              <tr key={provider.key} className="border-b border-fd-border">
                <td className="py-2 pr-4 font-medium">{provider.name}</td>
                {messageFields.map((field) => (
                  <td key={field} className="px-2 py-2">
                    <SupportMark supported={support[field] === true} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
