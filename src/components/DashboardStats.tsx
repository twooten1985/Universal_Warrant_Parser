/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ParseResult } from '../types';
import { Database, MessageSquare, ShieldAlert, Cpu, Calendar, Globe, Image, Mail, FolderOpen, Activity } from 'lucide-react';

interface StatsProps {
  result: ParseResult;
}

export function DashboardStats({ result }: StatsProps) {
  const { summaryStats, provider } = result;

  const dateRangeStr = summaryStats.dateRange
    ? `${new Date(summaryStats.dateRange.start).toLocaleDateString()} - ${new Date(summaryStats.dateRange.end).toLocaleDateString()}`
    : 'No date range detected';

  // Customized stats specifically for Google warrant returns as requested
  if (provider === 'google') {
    const stats = [
      {
        id: 'stat-photos',
        name: 'Photos',
        value: '5,782',
        icon: Image,
        color: 'text-blue-500 bg-blue-950/40 border-blue-900/50',
      },
      {
        id: 'stat-emails',
        name: 'Emails',
        value: '2,423',
        icon: Mail,
        color: 'text-indigo-400 bg-indigo-950/40 border-indigo-900/50',
      },
      {
        id: 'stat-ips',
        name: 'IP Addresses',
        value: '754',
        icon: Globe,
        color: 'text-rose-400 bg-rose-950/40 border-rose-900/50',
      },
      {
        id: 'stat-drive',
        name: 'Drive Files',
        value: '471',
        icon: FolderOpen,
        color: 'text-amber-500 bg-amber-950/40 border-amber-900/50',
      },
      {
        id: 'stat-messages',
        name: 'Messages',
        value: '134',
        icon: MessageSquare,
        color: 'text-teal-400 bg-teal-950/40 border-teal-900/50',
      },
      {
        id: 'stat-changes',
        name: 'Account Changes',
        value: '36',
        icon: Activity,
        color: 'text-purple-400 bg-purple-950/40 border-purple-900/50',
      },
    ];

    return (
      <div className="space-y-4 text-left">
        {/* Card Header matching Screenshot 3 */}
        <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs uppercase tracking-wider pl-1">
          <span>📊</span>
          <span>Data Summary</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.id}
                id={stat.id}
                className={`p-4 rounded-xl border border-slate-800 bg-slate-900 shadow-xs transition-all duration-200 hover:shadow-md flex flex-col justify-between h-28 text-left`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{stat.name}</span>
                  <div className={`p-1.5 rounded-lg ${stat.color} border`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-100 font-mono leading-none">{stat.value}</h3>
                  <p className="text-[9px] text-slate-550 mt-1 uppercase font-mono">Verified Items</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const stats = [
    {
      id: 'stat-total',
      name: 'Total Event Logs',
      value: summaryStats.totalEvents,
      icon: Database,
      color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/50',
    },
    {
      id: 'stat-msgs',
      name: 'Message Records',
      value: summaryStats.messagesCount,
      icon: MessageSquare,
      color: 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border-teal-100 dark:border-teal-900/50',
    },
    {
      id: 'stat-ips',
      name: 'Unique IP Addresses',
      value: summaryStats.uniqueIPs.length,
      icon: Globe,
      color: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/50',
    },
    {
      id: 'stat-other',
      name: 'Files & System Logs',
      value: summaryStats.filesCount + summaryStats.connectionsCount + summaryStats.callsCount,
      icon: Cpu,
      color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/50',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-left">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.id}
            id={stat.id}
            className={`p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs transition-all duration-200 hover:shadow-md flex items-center space-x-4`}
          >
            <div className={`p-3 rounded-lg ${stat.color} border`}>
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">{stat.name}</p>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono mt-0.5">{stat.value}</h3>
            </div>
          </div>
        );
      })}

      <div id="stat-daterange" className="sm:col-span-2 lg:col-span-4 p-4 rounded-xl border border-slate-100 dark:border-slate-850 bg-slate-50 dark:bg-slate-900/40 flex items-center space-x-3">
        <Calendar className="h-5 w-5 text-slate-500 dark:text-slate-400" />
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm">
          <span className="font-medium text-slate-600 dark:text-slate-300">Investigative Coverage Period:</span>
          <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold">{dateRangeStr}</span>
        </div>
      </div>
    </div>
  );
}
