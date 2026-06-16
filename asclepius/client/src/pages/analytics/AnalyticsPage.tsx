import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { useFacilityKpis } from '@/lib/api';

// Phase 1 Lakebase data-path proof: reads facility KPIs from the Lakebase
// Postgres route GET /api/data/facility-kpis (schema app_read, synced from UC),
// via the typed useFacilityKpis() hook in lib/api.ts. This replaces the prior
// warehouse useAnalyticsQuery('facility_kpis') call and proves the READ path.
export function AnalyticsPage() {
  const kpis = useFacilityKpis();

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>
            Lakebase data path — live read from app_read.facilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {kpis.loading && <Skeleton className="h-10 w-2/3" />}
          {kpis.error && (
            <div className="text-destructive bg-destructive/10 p-3 rounded-md">
              Error: {kpis.error}
            </div>
          )}
          {kpis.data && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Kpi label="Facilities" value={kpis.data.total_facilities} />
              <Kpi label="States" value={kpis.data.states} />
              <Kpi label="Districts" value={kpis.data.districts} />
              <Kpi label="Claimed" value={kpis.data.claimed_facilities} />
              <Kpi label="Unverified" value={kpis.data.unverified_facilities} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-primary">{String(value)}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
