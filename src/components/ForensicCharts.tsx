/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { ForensicEvent } from '../types';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  Legend
} from 'recharts';
import { ShieldAlert, Globe, Clock, MessageSquare } from 'lucide-react';

interface ChartsProps {
  events: ForensicEvent[];
}

export function ForensicCharts({ events }: ChartsProps) {
  // 1. Group Events by Date
  const activityOverTimeData = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach((e) => {
      try {
        const dateStr = new Date(e.timestamp).toISOString().split('T')[0];
        counts[dateStr] = (counts[dateStr] || 0) + 1;
      } catch {}
    });

    return Object.entries(counts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [events]);

  // 2. Group Events by Hour of Day (0 - 23)
  const activityByHourData = useMemo(() => {
    const counts = Array.from({ length: 24 }, (_, i) => ({
      hour: `${String(i).padStart(2, '0')}:00`,
      count: 0
    }));

    events.forEach((e) => {
      try {
        const d = new Date(e.timestamp);
        const hr = d.getUTCHours();
        counts[hr].count += 1;
      } catch {}
    });

    return counts;
  }, [events]);

  // 3. Top Sender / Network Identities
  const topIdentities = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach((e) => {
      if (e.sender) {
        counts[e.sender] = (counts[e.sender] || 0) + 1;
      }
    });

    return Object.entries(counts)
      .map(([identity, count]) => ({ identity, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [events]);

  // 4. IP Frequency List
  const ipLogs = useMemo(() => {
    const counts: Record<string, { count: number; locations: Set<string> }> = {};
    events.forEach((e) => {
      if (e.ipAddress) {
        const ip = e.ipAddress.trim();
        if (ip) {
          if (!counts[ip]) {
            counts[ip] = { count: 0, locations: new Set() };
          }
          counts[ip].count++;
          if (e.location) {
            counts[ip].locations.add(e.location);
          }
        }
      }
    });

    return Object.entries(counts)
      .map(([ip, data]) => ({
        ip,
        count: data.count,
        locations: Array.from(data.locations).join(', ') || 'N/A'
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div id="forensic-analytics-section" className="space-y-6 text-left">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Timeline Chart */}
        <div id="chart-timeline" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex items-center space-x-2 mb-4">
            <MessageSquare className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
            <div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Forensic Activity Wave</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">Chronological volume distribution of parsed case logs.</p>
            </div>
          </div>
          
          <div className="h-64">
            {activityOverTimeData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-600 text-xs">
                Insufficient timestamp attributes for volume mapping.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
                <AreaChart data={activityOverTimeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '8px' }}
                    labelStyle={{ color: '#94a3b8', fontSize: '11px', fontWeight: 'bold' }}
                    itemStyle={{ color: '#38bdf8', fontSize: '12px' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCount)" name="Event Logs" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Diurnal analysis (Hour of Day) */}
        <div id="chart-diurnal" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex items-center space-x-2 mb-4">
            <Clock className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
            <div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Diurnal Sleep Pattern Log</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">Activity mapped in UTC hours. Helps isolate subject waking schedules.</p>
            </div>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
              <BarChart data={activityByHourData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="hour" fontSize={9} stroke="#94a3b8" tickLine={false} interval={2} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '8px' }}
                  labelStyle={{ color: '#94a3b8', fontSize: '11px', fontWeight: 'bold' }}
                  itemStyle={{ color: '#38bdf8', fontSize: '12px' }}
                />
                <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} name="Log Entries">
                  {activityByHourData.map((entry, index) => {
                    const isHigh = entry.count > 0;
                    return (
                      <Cell
                        key={`cell-${index}`}
                        className={isHigh ? 'fill-teal-600 dark:fill-teal-450' : 'fill-slate-200 dark:fill-slate-800/40'}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Active Interacting Parties */}
        <div id="chart-participants" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1">Top Chat Identities / Node Senders</h4>
          <p className="text-xs text-slate-500 search-deck dark:text-slate-400 mb-4">Top contributors by log line volume inside search parameters.</p>

          <div className="space-y-3.5">
            {topIdentities.map((item, idx) => {
              const maxCount = topIdentities[0]?.count || 1;
              const percentage = (item.count / maxCount) * 100;
              return (
                <div key={item.identity} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[240px]" title={item.identity}>
                      {idx + 1}. {item.identity}
                    </span>
                    <span className="text-slate-500 dark:text-slate-450 font-mono font-medium">{item.count} items</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {topIdentities.length === 0 && (
              <div className="text-center py-10 text-slate-400 dark:text-slate-650 text-xs">No identities recognized.</div>
            )}
          </div>
        </div>

        {/* IP logs profile listing */}
        <div id="logs-ip-address" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <Globe className="h-5 w-5 text-rose-600 dark:text-rose-450" />
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Critical Forensic IP Nodes</h4>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Highest occurrence IP client addresses extracted from return.</p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 flex-1">
            {ipLogs.map((item, idx) => (
              <div key={item.ip} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span className="text-xs bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded font-mono text-slate-500 dark:text-slate-400 font-bold">
                    #{idx + 1}
                  </span>
                  <div className="truncate">
                    <span className="font-mono text-sm block font-semibold text-rose-700 dark:text-rose-400 select-all leading-tight">{item.ip}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Mapped Country: {item.locations}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 block">{item.count} hits</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Log Connections</span>
                </div>
              </div>
            ))}

            {ipLogs.length === 0 && (
              <div className="text-center py-10 text-slate-400 dark:text-slate-600 text-xs">No IP addresses parsed.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
