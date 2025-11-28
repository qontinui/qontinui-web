"use client";

import React, { useMemo } from "react";
import {
  Transition,
  State,
  OutgoingTransition,
  IncomingTransition,
} from "@/contexts/automation-context/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { TransitionValidation, COLORS } from "./types";

interface TransitionStatisticsViewProps {
  transitions: Transition[];
  states: State[];
  validation: TransitionValidation;
}

export function TransitionStatisticsView({
  transitions,
  states,
  validation,
}: TransitionStatisticsViewProps) {
  const stats = useMemo(() => {
    const outgoing = transitions.filter(
      (t): t is OutgoingTransition => t.type === "OutgoingTransition"
    );
    const incoming = transitions.filter(
      (t): t is IncomingTransition => t.type === "IncomingTransition"
    );

    // Count transitions per state
    const transitionsPerState = new Map<string, number>();
    outgoing.forEach((t) => {
      transitionsPerState.set(
        t.fromState,
        (transitionsPerState.get(t.fromState) || 0) + 1
      );
    });

    const avgTransitions =
      transitionsPerState.size > 0
        ? Array.from(transitionsPerState.values()).reduce((a, b) => a + b, 0) /
          transitionsPerState.size
        : 0;

    // Most connected states
    const sortedStates = Array.from(transitionsPerState.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([stateId, count]) => ({
        name: states.find((s) => s.id === stateId)?.name || "Unknown",
        count,
      }));

    // Coverage
    const statesWithTransitions = new Set([
      ...outgoing.map((t) => t.fromState),
      ...incoming.map((t) => t.toState),
    ]);
    const coverage =
      states.length > 0
        ? (statesWithTransitions.size / states.length) * 100
        : 0;

    return {
      total: transitions.length,
      outgoing: outgoing.length,
      incoming: incoming.length,
      avgTransitions: avgTransitions.toFixed(1),
      mostConnected: sortedStates,
      coverage: coverage.toFixed(1),
      orphaned: validation.unreachableStates.length,
      circular: validation.circular.length,
      deadEnd: validation.deadEndStates.length,
    };
  }, [transitions, states, validation]);

  const pieData = [
    { name: "Outgoing", value: stats.outgoing, color: COLORS.success },
    { name: "Incoming", value: stats.incoming, color: COLORS.primary },
  ];

  return (
    <div className="h-full overflow-y-auto space-y-4 p-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">
              Total Transitions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00D9FF]">
              {stats.total}
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">
              Avg per State
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#00FF88]">
              {stats.avgTransitions}
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#BD00FF]">
              {stats.coverage}%
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-gray-400">Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#FF4444]">
              {stats.circular + stats.orphaned + stats.deadEnd}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader>
            <CardTitle className="text-sm">Transition Types</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#27272A",
                    border: "1px solid #666",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-gray-700 bg-[#27272A]">
          <CardHeader>
            <CardTitle className="text-sm">Most Connected States</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.mostConnected}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                  dataKey="name"
                  stroke="#666"
                  style={{ fontSize: "12px" }}
                />
                <YAxis stroke="#666" style={{ fontSize: "12px" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#27272A",
                    border: "1px solid #666",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="count" fill={COLORS.primary} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
