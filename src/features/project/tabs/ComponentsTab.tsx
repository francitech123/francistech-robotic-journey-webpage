import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type Component = {
  _id: string;
  name: string;
  description?: string;
  quantity: number;
  unit?: string;
  category?: string;
  partNumber?: string;
  manufacturer?: string;
  estimatedUnitCost?: number;
  currency?: string;
  supplierName?: string;
  supplierUrl?: string;
  notes?: string;
};

export default function ComponentsTab() {
  const { projectNumber, slug } = useParams();
  const [components, setComponents] = useState<Component[]>([]);
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectNumber}/${slug}/components`)
      .then((r) => r.json())
      .then((r) => {
        setComponents(r?.data?.components ?? []);
        setEstimatedTotal(r?.data?.estimatedTotal ?? null);
        setCurrency(r?.data?.currency ?? "USD");
      })
      .finally(() => setLoading(false));
  }, [projectNumber, slug]);

  if (loading) return <div className="skeleton skeleton--table" />;

  return (
    <section className="tab-components">
      <h2>Bill of Materials</h2>
      {components.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No components listed yet.</p>
        </div>
      ) : (
        <>
          <table className="bom-table">
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Qty</th>
                <th>Purpose</th>
                <th>Required</th>
                <th className="num">Unit cost</th>
                <th className="num">Total</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c) => (
                <tr key={c._id}>
                  <td>
                    <div className="bom-name">{c.name}</div>
                    {c.manufacturer && <div className="bom-sub">{c.manufacturer} {c.partNumber}</div>}
                  </td>
                  <td className="num">{c.quantity} {c.unit ?? "pcs"}</td>
                  <td>{c.description || "—"}</td>
                  <td>{c.notes?.toLowerCase().includes("optional") ? "Optional" : "Yes"}</td>
                  <td className="num">{c.estimatedUnitCost != null ? `${c.currency ?? "USD"} ${c.estimatedUnitCost}` : "—"}</td>
                  <td className="num">{c.estimatedUnitCost != null ? `${c.currency ?? "USD"} ${(c.quantity * c.estimatedUnitCost).toFixed(2)}` : "—"}</td>
                  <td>
                    {c.supplierUrl
                      ? <a href={c.supplierUrl} target="_blank" rel="noopener noreferrer">{c.supplierName ?? "Link"}</a>
                      : (c.supplierName ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
            {estimatedTotal != null && (
              <tfoot>
                <tr>
                  <td colSpan={5} className="bom-total-label">Estimated total</td>
                  <td className="num bom-total-value">{currency} {estimatedTotal.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          <p className="bom-disclaimer">Costs are estimates unless verified from a current source.</p>
        </>
      )}
    </section>
  );
}
