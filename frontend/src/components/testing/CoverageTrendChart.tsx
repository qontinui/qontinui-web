'use client';

import { useCoverageTrends } from '@/hooks/useTesting';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

interface CoverageTrendChartProps {
  projectId: string;
  startDate?: string;
  endDate?: string;
}

export function CoverageTrendChart({ projectId, startDate, endDate }: CoverageTrendChartProps) {
  const { data: trends, isLoading, error } = useCoverageTrends(projectId, startDate, endDate);

  if (isLoading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">Loading coverage trends...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">Error loading trends: {error.message}</div>
        </CardContent>
      </Card>
    );
  }

  if (!trends || trends.length === 0) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Coverage Trends</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">No coverage data available for the selected period</div>
        </CardContent>
      </Card>
    );
  }

  // Format data for Recharts
  const chartData = trends.map((trend) => ({
    date: format(new Date(trend.date), 'MMM dd'),
    coverage: trend.coverage_percentage,
    statesCovered: trend.states_covered,
    totalStates: trend.total_states,
    testRuns: trend.test_run_count,
  }));

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <CardHeader>
        <CardTitle>Coverage Trends</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="date"
              stroke="#888"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="#888"
              style={{ fontSize: '12px' }}
              domain={[0, 100]}
              label={{ value: 'Coverage %', angle: -90, position: 'insideLeft', style: { fill: '#888' } }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1A1A1B',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '12px',
              }}
              labelStyle={{ color: '#fff', marginBottom: '8px' }}
              itemStyle={{ color: '#fff' }}
              formatter={(value: any, name: string) => {
                if (name === 'coverage') return [`${value.toFixed(1)}%`, 'Coverage'];
                if (name === 'statesCovered') return [value, 'States Covered'];
                if (name === 'testRuns') return [value, 'Test Runs'];
                return [value, name];
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              iconType="line"
              formatter={(value) => {
                if (value === 'coverage') return 'Coverage %';
                if (value === 'statesCovered') return 'States Covered';
                if (value === 'testRuns') return 'Test Runs';
                return value;
              }}
            />
            <Line
              type="monotone"
              dataKey="coverage"
              stroke="#00D9FF"
              strokeWidth={2}
              dot={{ fill: '#00D9FF', r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="statesCovered"
              stroke="#BD00FF"
              strokeWidth={2}
              dot={{ fill: '#BD00FF', r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="testRuns"
              stroke="#00FF88"
              strokeWidth={2}
              dot={{ fill: '#00FF88', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="text-center p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Average Coverage</div>
            <div className="text-2xl font-bold text-[#00D9FF]">
              {(trends.reduce((acc, t) => acc + t.coverage_percentage, 0) / trends.length).toFixed(1)}%
            </div>
          </div>
          <div className="text-center p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Total Test Runs</div>
            <div className="text-2xl font-bold text-[#BD00FF]">
              {trends.reduce((acc, t) => acc + t.test_run_count, 0)}
            </div>
          </div>
          <div className="text-center p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-1">Latest Coverage</div>
            <div className="text-2xl font-bold text-[#00FF88]">
              {trends[trends.length - 1]?.coverage_percentage.toFixed(1)}%
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
