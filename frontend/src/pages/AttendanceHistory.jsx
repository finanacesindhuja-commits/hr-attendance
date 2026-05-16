import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5002';

export default function AttendanceHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const navigate = useNavigate();

  useEffect(() => {
    const info = localStorage.getItem('staffInfo');
    if (!info) { navigate('/login'); return; }
    const parsed = JSON.parse(info);
    fetchHistory(parsed.staff_id, selectedMonth, selectedYear);
  }, [navigate, selectedMonth, selectedYear]);

  const fetchHistory = async (staffId, month, year) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/staff/attendance/history/${staffId}`, {
        params: { month, year }
      });
      setHistory(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString(undefined, { 
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' 
    });
  };

  const formatTime = (isoString) => {
    return isoString ? new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-indigo-600 border-indigo-100"></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <nav className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Personal Attendance Log</h1>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto p-4 md:p-8">
        {/* Month Selector */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">Showing Logs For</h2>
            <p className="text-2xl font-bold text-gray-900">
              {new Date(selectedYear, selectedMonth - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          
          <div className="flex gap-2">
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="bg-white border-2 border-gray-100 rounded-2xl px-4 py-2 font-bold text-gray-700 outline-none focus:border-indigo-600 transition-all cursor-pointer"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(0, i).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>

            <select 
              value={selectedYear} 
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="bg-white border-2 border-gray-100 rounded-2xl px-4 py-2 font-bold text-gray-700 outline-none focus:border-indigo-600 transition-all cursor-pointer"
            >
              {[2024, 2025, 2026].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] border-b">
                <tr>
                  <th className="px-8 py-5">Date</th>
                  <th className="px-8 py-5">Check In</th>
                  <th className="px-8 py-5">Check Out</th>
                  <th className="px-8 py-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-8 py-6 font-bold text-gray-700 whitespace-nowrap">
                      {formatDate(record.date)}
                    </td>
                    <td className="px-8 py-6 font-mono text-sm text-indigo-600 font-semibold">
                      {formatTime(record.check_in)}
                    </td>
                    <td className="px-8 py-6 font-mono text-sm text-amber-600 font-semibold">
                      {formatTime(record.check_out)}
                    </td>
                    <td className="px-8 py-6">
                      <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider ${
                        record.status === 'present' ? 'bg-green-100 text-green-700' :
                        record.status === 'LEAVE' ? 'bg-blue-100 text-blue-700' :
                        record.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {record.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-8 py-20 text-center text-gray-400 italic font-medium">No records found. Start your first workday!</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
