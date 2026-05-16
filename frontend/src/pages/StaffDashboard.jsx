import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Geolocation } from '@capacitor/geolocation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
const TRACKING_URL = import.meta.env.VITE_TRACKING_URL || 'http://localhost:5001';

let socket;

function StaffDashboard() {
  const [staff, setStaff] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [workingDays, setWorkingDays] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [trackingActive, setTrackingActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPaySlip, setShowPaySlip] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showApplyLeave, setShowApplyLeave] = useState(false);
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [leaveData, setLeaveData] = useState({ start_date: '', end_date: '', reason: '' });
  const [payslips, setPayslips] = useState([]);
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const dropdownRef = useRef(null);
  const watchIdRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const savedStaff = localStorage.getItem('staffInfo');
    if (!savedStaff) {
      navigate('/login');
      return;
    }
    const staffData = JSON.parse(savedStaff);
    setStaff(staffData);
    fetchAttendanceStatus(staffData.staff_id);
    fetchWorkingDays(staffData.staff_id);

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => {
      clearInterval(timer);
      stopLocationTracking();
    };
  }, [navigate]);

  useEffect(() => {
    // Start tracking if checked in and not already tracking
    if (staff && attendance && attendance.check_in && !attendance.check_out && !trackingActive) {
      startLocationTracking(staff.staff_id, staff.name);
    }
  }, [attendance, staff, trackingActive]);

  useEffect(() => {
    if (showPaySlip && staff) {
      fetchPayslips(staff.staff_id);
    }
  }, [showPaySlip, staff]);

  const fetchPayslips = async (staffId) => {
    try {
      const res = await axios.get(`${API_URL}/staff/payslips/${staffId}`);
      setPayslips(res.data || []);
    } catch (err) {
      console.error('Failed to fetch payslips', err);
    }
  };

  const fetchLeaveHistory = async (staffId) => {
    try {
      const res = await axios.get(`${API_URL}/staff/leave/history/${staffId}`);
      setLeaveHistory(res.data || []);
    } catch (err) {
      console.error('Failed to fetch leave history', err);
    }
  };

  const handleApplyLeave = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      await axios.post(`${API_URL}/staff/leave/apply`, {
        staff_id: staff.staff_id,
        ...leaveData
      });
      alert('Leave application submitted successfully!');
      setShowApplyLeave(false);
      setLeaveData({ start_date: '', end_date: '', reason: '' });
      fetchLeaveHistory(staff.staff_id);
    } catch (err) {
      alert('Failed to submit leave: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoading(false);
    }
  };


  const fetchAttendanceStatus = async (staffId) => {
    try {
      const response = await axios.get(`${API_URL}/staff/attendance/status/${staffId}`);
      setAttendance(response.data);
    } catch (err) {
      console.error('Failed to fetch attendance', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWorkingDays = async (staffId) => {
    try {
      const res = await axios.get(`${API_URL}/staff/attendance/history/${staffId}`);
      if (res.data) {
        const currentDate = new Date();
        const thisMonthRecords = res.data.filter(r => {
          const d = new Date(r.date);
          return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
        });
        setWorkingDays(thisMonthRecords.length);
      }
    } catch (err) {
      console.error('Failed to fetch working days', err);
    }
  };

  const [socketError, setSocketError] = useState(null);
  const [geoError, setGeoError] = useState(null);

  const startLocationTracking = async (staffId, staffName) => {
    if (trackingActive) return;

    setSocketError(null);
    setGeoError(null);
    console.log('🚀 Starting live socket tracking...');

    socket = io(TRACKING_URL);
    setTrackingActive(true);

    socket.on('connect_error', (err) => {
      console.error('Socket Connection Error:', err);
      setSocketError('Server Connection Failed');
    });

    try {
      watchIdRef.current = await Geolocation.watchPosition(
        { enableHighAccuracy: true, maximumAge: 0 },
        (position, error) => {
          if (error) {
            console.error('Geolocation Error:', error);
            setGeoError('GPS / Permission Denied');
            return;
          }
          if (position) {
            const { latitude, longitude } = position.coords;
            setGeoError(null);

            const locationData = {
              staff_id: staffId,
              name: staffName,
              latitude,
              longitude
            };

            // 1. Send via Socket (Instant)
            if (socket && socket.connected) {
              socket.emit('staff-location-update', locationData);
            }

            // 2. Send via REST (Reliable Fallback to Admin Server)
            axios.post(`${TRACKING_URL}/staff/update-location`, locationData)
              .catch(err => console.error('REST location update failed', err));
          }
        }
      );
    } catch (err) {
      console.error('Geolocation Error:', err);
      setGeoError('GPS setup failed');
    }
  };

  const stopLocationTracking = async () => {
    if (watchIdRef.current) {
      await Geolocation.clearWatch({ id: watchIdRef.current });
      watchIdRef.current = null;
    }
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    setTrackingActive(false);
  };

  const handleCheckIn = async () => {
    setActionLoading(true);
    try {
      // Prompt for permissions natively just in case
      await Geolocation.checkPermissions();
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true, timeout: 15000, maximumAge: 60000
      });

      const { latitude, longitude } = pos.coords;
      const response = await axios.post(`${API_URL}/staff/attendance/check-in`, {
        staff_id: staff.staff_id, latitude, longitude
      });
      setAttendance(response.data.attendance);
      startLocationTracking(staff.staff_id, staff.name);

    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || err.message || 'Check-in failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    setActionLoading(true);
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true, timeout: 15000, maximumAge: 60000
      });

      const { latitude, longitude } = pos.coords;
      const response = await axios.post(`${API_URL}/staff/attendance/check-out`, {
        staff_id: staff.staff_id, latitude, longitude
      });
      setAttendance(response.data.attendance);
      stopLocationTracking();

    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || err.message || 'Check-out failed');
    } finally {
      setActionLoading(false);
    }
  };

  const checkGPSStatus = async () => {
    alert('🔍 Checking GPS... Please wait for the permit pop-up.');
    try {
      const pos = await Geolocation.getCurrentPosition();
      alert(`✅ GPS Working!\nLat: ${pos.coords.latitude}\nLng: ${pos.coords.longitude}`);
    } catch(err) {
      alert(`❌ GPS Error: ${err.message}`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('staffInfo');
    navigate('/login');
  };

  if (isLoading || !staff) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 text-indigo-600">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-indigo-600 border-indigo-100"></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white shadow-sm border-b border-gray-200 px-6 py-4 flex justify-between items-center relative z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="bg-indigo-600 p-2 rounded-lg text-white hidden xs:block">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="font-bold text-gray-900 text-lg md:text-xl">Staff Portal</span>
        </div>
        <div className="hidden md:flex items-center gap-4 relative" ref={dropdownRef}>
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="text-sm font-semibold text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded-lg transition-all flex items-center gap-2 border border-indigo-100 bg-white"
            >
              My History
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in duration-200">
                <button
                  onClick={() => { setIsDropdownOpen(false); navigate('/history'); }}
                  className="w-full text-left px-4 py-3 text-sm font-bold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-3 transition-colors"
                >
                  <span className="text-lg">📋</span> Attendance History
                </button>
                <div className="h-px bg-gray-100 mx-2"></div>
                <button
                  onClick={() => { setIsDropdownOpen(false); setShowProfile(true); }}
                  className="w-full text-left px-4 py-3 text-sm font-bold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-3 transition-colors"
                >
                  <span className="text-lg">👤</span> View My Profile
                </button>
                <button
                  onClick={() => { setIsDropdownOpen(false); setShowPaySlip(true); }}
                  className="w-full text-left px-4 py-3 text-sm font-bold text-gray-700 hover:bg-indigo-50 hover:text-green-600 flex items-center gap-3 transition-colors"
                >
                  <span className="text-lg">💸</span> My Pay Slips
                </button>
                <button
                  onClick={() => { setIsDropdownOpen(false); setShowLeave(true); }}
                  className="w-full text-left px-4 py-3 text-sm font-bold text-gray-700 hover:bg-indigo-50 hover:text-orange-600 flex items-center gap-3 transition-colors"
                >
                  <span className="text-lg">🗓️</span> Govt Holidays
                </button>
                <button
                  onClick={() => { setIsDropdownOpen(false); setShowTerms(true); }}
                  className="w-full text-left px-4 py-3 text-sm font-bold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-3 transition-colors"
                >
                  <span className="text-lg">📄</span> Terms & Conditions
                </button>
                <div className="h-px bg-gray-100 mx-2"></div>
                <button
                  onClick={() => { setIsDropdownOpen(false); setShowApplyLeave(true); fetchLeaveHistory(staff.staff_id); }}
                  className="w-full text-left px-4 py-3 text-sm font-bold text-gray-700 hover:bg-indigo-50 hover:text-red-600 flex items-center gap-3 transition-colors"
                >
                  <span className="text-lg">✉️</span> Apply Leave
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleLogout}
            className="text-gray-500 hover:text-red-600 font-medium transition-colors flex items-center gap-2 px-3 py-2 rounded-lg"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Mobile Sidebar */}
      <div className={`fixed inset-0 z-40 md:hidden transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)}></div>
        <div className={`absolute top-0 left-0 w-72 h-full bg-white shadow-2xl transition-transform duration-300 ease-out transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-indigo-600 text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center font-black">
                {staff.name?.charAt(0)}
              </div>
              <div>
                <p className="font-bold leading-tight">{staff.name}</p>
                <p className="text-[10px] opacity-70 uppercase font-black tracking-widest">{staff.staff_id} • {staff.role || 'Staff'}</p>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-white/10 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <nav className="p-4 space-y-2">
            <button
              onClick={() => { setIsSidebarOpen(false); setShowProfile(true); }}
              className="w-full flex items-center gap-4 px-4 py-4 text-gray-700 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:text-indigo-600 rounded-2xl transition-all"
            >
              <span className="text-lg">👤</span> View My Profile
            </button>
            <button
              onClick={() => navigate('/history')}
              className="w-full flex items-center gap-4 px-4 py-4 text-gray-700 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:text-indigo-600 rounded-2xl transition-all"
            >
              <span className="text-lg">📋</span> My History
            </button>
            <button
              onClick={() => { setIsSidebarOpen(false); setShowTerms(true); }}
              className="w-full flex items-center gap-4 px-4 py-4 text-gray-700 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:text-indigo-600 rounded-2xl transition-all"
            >
              <span className="text-lg">📄</span> Terms & Conditions
            </button>
            <button
              onClick={() => { setIsSidebarOpen(false); setShowPaySlip(true); }}
              className="w-full flex items-center gap-4 px-4 py-4 text-gray-700 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:text-green-600 rounded-2xl transition-all"
            >
              <span className="text-lg">💸</span> My Pay Slip
            </button>
            <button
              onClick={() => { setIsSidebarOpen(false); setShowLeave(true); }}
              className="w-full flex items-center gap-4 px-4 py-4 text-gray-700 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:text-orange-600 rounded-2xl transition-all"
            >
              <span className="text-lg">🗓️</span> Govt Holidays
            </button>
            <button
              onClick={() => { setIsSidebarOpen(false); setShowApplyLeave(true); fetchLeaveHistory(staff.staff_id); }}
              className="w-full flex items-center gap-4 px-4 py-4 text-gray-700 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:text-red-600 rounded-2xl transition-all"
            >
              <span className="text-lg">✉️</span> Apply Leave
            </button>
            <div className="pt-4 mt-4 border-t border-gray-100">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-4 px-4 py-4 text-red-500 font-black text-xs uppercase tracking-widest hover:bg-red-50 rounded-2xl transition-all"
              >
                <span className="text-lg">🚪</span> Sign Out
              </button>
            </div>
          </nav>
        </div>
      </div>

      <main className="flex-1 p-4 pt-10 sm:p-6 md:p-10 max-w-4xl mx-auto w-full">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 relative overflow-hidden">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Welcome, {staff.name}!</h2>
            <p className="text-gray-500 mt-2 font-medium">ID: {staff.staff_id} • {(staff.role || 'Staff').toUpperCase()}</p>
          </div>
          <div className="bg-indigo-50 border border-indigo-100 px-6 py-4 rounded-2xl flex flex-col items-center w-full sm:w-auto sm:min-w-[140px] shadow-inner">
            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Work Days ({new Date().toLocaleString('default', { month: 'short' })})</span>
            <span className="text-4xl font-black text-indigo-600">{workingDays}</span>
          </div>
        </div>

        <div className="max-w-xl mx-auto">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-8 flex flex-col items-center justify-center text-center">
            <div className="text-4xl xs:text-5xl font-mono font-bold text-indigo-600 mb-2">
              {currentTime.toLocaleTimeString()}
            </div>
            <div className="text-gray-400 font-medium mb-8">
              {currentTime.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>

            <div className="w-full space-y-4">
              {!attendance || !attendance.check_in ? (
                <button
                  onClick={handleCheckIn}
                  disabled={actionLoading}
                  className="w-full py-6 sm:py-8 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-lg md:text-xl rounded-[1.5rem] shadow-2xl shadow-emerald-200 transform hover:-translate-y-1 active:scale-95 transition-all flex flex-col items-center justify-center gap-2 group disabled:opacity-50 disabled:pointer-events-none"
                >
                  <span className="text-3xl md:text-4xl group-hover:animate-rotate-jump">👋</span>
                  {actionLoading ? 'Processing...' : 'START WORK DAY (CHECK-IN)'}
                </button>
              ) : attendance && !attendance.check_out ? (
                <button
                  onClick={handleCheckOut}
                  disabled={actionLoading}
                  className="w-full py-6 sm:py-8 bg-rose-500 hover:bg-rose-600 text-white font-black text-lg md:text-xl rounded-[1.5rem] shadow-2xl shadow-rose-200 transform hover:-translate-y-1 active:scale-95 transition-all flex flex-col items-center justify-center gap-2 group disabled:opacity-50 disabled:pointer-events-none"
                >
                  <span className="text-3xl md:text-4xl group-hover:animate-pulse-slow">🛑</span>
                  {actionLoading ? 'Processing...' : 'END WORK DAY (CHECK-OUT)'}
                </button>
              ) : (
                <div className="w-full py-6 sm:py-8 bg-slate-50 border-2 border-slate-200 text-slate-400 font-black text-lg md:text-xl rounded-[1.5rem] flex flex-col items-center justify-center gap-2">
                  <span className="text-4xl grayscale opacity-50">🎉</span>
                  <span className="uppercase tracking-widest text-sm">Shift Completed</span>
                </div>
              )}
            </div>
          </div>
          {/* Background tracking active, UI intentionally hidden as requested */}
        </div>
      </main>

      {/* Profile Modal */}
      {showProfile && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-6 sm:p-10 relative overflow-y-auto max-h-[90vh]">
            <div className="absolute top-0 left-0 w-full h-24 bg-indigo-600"></div>
            <div className="relative mt-4 flex flex-col items-center">
              <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center text-3xl sm:text-4xl font-black text-indigo-600 border-4 border-white mb-6 uppercase">
                {staff.name?.charAt(0)}
              </div>
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter mb-1">{staff.name}</h3>
              <p className="text-xs font-black text-indigo-500 uppercase tracking-[0.2em] mb-8">Official {staff.role || 'Staff Member'}</p>
              <div className="w-full space-y-4">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex justify-between items-center">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Status Today</span>
                  <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg ${attendance?.check_out ? 'bg-green-100 text-green-700' :
                    attendance?.check_in ? 'bg-blue-100 text-blue-700 animate-pulse' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                    {attendance?.check_out ? 'Completed' : attendance?.check_in ? 'At Work' : 'Not Started'}
                  </span>
                </div>

                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex justify-between items-center">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Staff ID</span>
                  <span className="font-mono text-sm font-black text-gray-900">{staff.staff_id}</span>
                </div>

                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex justify-between items-center">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Mobile</span>
                  <span className="text-sm font-bold text-gray-900">{staff.mobile || 'Not Linked'}</span>
                </div>

                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex justify-between items-center">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Designation</span>
                  <span className="text-sm font-black text-gray-900 uppercase">{staff.role || 'Staff'}</span>
                </div>

                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex justify-between items-center">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Joined On</span>
                  <span className="text-sm font-bold text-gray-700">
                    {new Date(staff.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>

                <div className="bg-indigo-50/30 p-5 rounded-2xl border border-indigo-100/50">
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Police Verification</p>
                  {staff.police_verification_url ? (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-green-600 flex items-center gap-1">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                        Uploaded
                      </span>
                      <a href={staff.police_verification_url} target="_blank" rel="noreferrer" className="text-[10px] font-black text-indigo-600 uppercase underline">View Document</a>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-2">
                      <input
                        type="file"
                        id="verificationUpload"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={async (e) => {
                          const file = e.target.files[0];
                          if (!file) return;

                          const formData = new FormData();
                          formData.append('verificationFile', file);
                          formData.append('staff_id', staff.staff_id);

                          try {
                            setActionLoading(true);
                            const res = await axios.post(`${API_URL}/staff/upload-verification`, formData);
                            // Update local staff state
                            const updatedStaff = { ...staff, police_verification_url: res.data.url };
                            setStaff(updatedStaff);
                            localStorage.setItem('staffInfo', JSON.stringify(updatedStaff));
                            alert('Uploaded Successfully!');
                          } catch (err) {
                            alert('Upload failed: ' + (err.response?.data?.error || err.message));
                          } finally {
                            setActionLoading(false);
                          }
                        }}
                      />
                      <label
                        htmlFor="verificationUpload"
                        className="w-full py-3 bg-white border-2 border-dashed border-indigo-200 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest text-center cursor-pointer hover:bg-indigo-50 transition-all"
                      >
                        {actionLoading ? 'Uploading...' : 'Upload Document +'}
                      </label>
                      <p className="text-[8px] text-gray-400 mt-2 lowercase font-bold">pdf, jpg, png supported (max 5mb)</p>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => navigate('/change-password')}
                    className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-100"
                  >
                    Change My Password 🔐
                  </button>
                </div>
              </div>
              <button onClick={() => setShowProfile(false)} className="w-full mt-8 py-4 bg-gray-900 text-white rounded-[1.2rem] font-black uppercase tracking-widest text-xs hover:bg-gray-800 transition-all active:scale-95 shadow-lg">Close Details</button>
            </div>
          </div>
        </div>
      )}

      {/* Terms & Conditions Modal */}
      {showTerms && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-6 sm:p-10 relative overflow-y-auto max-h-[90vh]">
            <div className="flex flex-col">
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center text-3xl mb-6">📄</div>
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter mb-4">Terms & Conditions</h3>

              <div className="space-y-4 text-sm text-gray-600 font-medium leading-relaxed">
                <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                  <p className="font-bold text-indigo-900 mb-1">1. Location Tracking</p>
                  <p className="text-xs">Your live location is securely tracked in the background from Check-In until Check-Out. You must allow GPS permissions for accurate tracking.</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="font-bold text-gray-900 mb-1">2. Attendance Policy</p>
                  <p className="text-xs">Staff members must check-in and check-out daily. Forgetting to Check-Out may result in an invalid work day log and impact your payouts.</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="font-bold text-gray-900 mb-1">3. Usage Guidelines</p>
                  <p className="text-xs">Ensure your device is fully charged, not restricted by battery saver modes, and always has an active mobile data connection.</p>
                </div>
              </div>

              <button onClick={() => setShowTerms(false)} className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-[1.2rem] font-black uppercase tracking-widest text-xs hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-200">
                I Understand
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Slip Modal */}
      {showPaySlip && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-6 sm:p-10 relative overflow-y-auto max-h-[90vh]">
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center text-4xl mb-6 shadow-inner border border-green-100">💸</div>
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter mb-2">My Pay Slips</h3>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-8">Salary & Payouts</p>

              <div className="w-full space-y-3 mb-6">
                {payslips.length > 0 ? (
                  payslips.map((pay, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => setSelectedPayslip(pay)}
                      className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm text-left hover:border-indigo-400 cursor-pointer transition-all active:scale-[0.98]"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="text-xs font-black text-indigo-500 uppercase tracking-widest">{pay.month_year} PAYSLIP</p>
                          <p className="text-sm font-black text-gray-900 mt-0.5">Net Pay: ₹{pay.net_salary}</p>
                        </div>
                        <span className="bg-green-100 text-green-700 text-[10px] font-black uppercase px-2 py-1 rounded-lg border border-green-200">
                          {pay.status || 'Paid'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                        <span>Click to View Details</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="w-full bg-gray-50 rounded-2xl p-8 border border-gray-100 border-dashed">
                    <div className="text-gray-400 mb-3 block">
                      <svg className="w-10 h-10 mx-auto opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-bold text-gray-500">Pay slips are not generated yet.</p>
                    <p className="text-[10px] text-gray-400 mt-2 font-bold uppercase tracking-wider">Check back after billing cycle</p>
                  </div>
                )}
              </div>


              <button onClick={() => setShowPaySlip(false)} className="w-full mt-4 py-4 bg-gray-900 text-white rounded-[1.2rem] font-black uppercase tracking-widest text-xs hover:bg-gray-800 transition-all active:scale-95 shadow-lg">
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Govt Holidays Modal */}
      {showLeave && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md p-6 sm:p-10 relative overflow-y-auto max-h-[90vh]">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center text-3xl mb-6 shadow-inner border border-orange-100">🇮🇳</div>
              <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter mb-2">Holidays 2026</h3>


              <div className="w-full space-y-2.5 mb-6 text-left">
                {[
                  { name: "New Year's Day", date: "Jan 1" },
                  { name: "Pongal", date: "Jan 14" },
                  { name: "Thiruvalluvar Day", date: "Jan 15" },
                  { name: "Uzhavar Thirunal", date: "Jan 16" },
                  { name: "Republic Day", date: "Jan 26" },
                  { name: "Good Friday", date: "Apr 3" },
                  { name: "Tamil New Year", date: "Apr 14" },
                  { name: "May Day", date: "May 1" },
                  { name: "Independence Day", date: "Aug 15" },
                  { name: "Vinayagar Chaturthi", date: "Sep 13" },
                  { name: "Gandhi Jayanthi", date: "Oct 2" },
                  { name: "Ayutha Pooja", date: "Oct 20" },
                  { name: "Deepavali", date: "Nov 8" },
                  { name: "Christmas", date: "Dec 25" }
                ].map((holiday, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                    <span className="font-bold text-gray-900 text-sm">{holiday.name}</span>
                    <span className="text-xs font-black text-orange-600 bg-orange-50 px-2 py-1 rounded-lg border border-orange-100/50 min-w-[55px] text-center">{holiday.date}</span>
                  </div>
                ))}
              </div>

              <button onClick={() => setShowLeave(false)} className="w-full py-4 bg-gray-900 text-white rounded-[1.2rem] font-black uppercase tracking-widest text-xs hover:bg-gray-800 transition-all active:scale-95 shadow-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Apply Leave Modal */}
      {showApplyLeave && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg p-6 sm:p-10 relative overflow-y-auto max-h-[90vh]">
            <div className="flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">Apply for Leave</h3>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-1">Submit your request</p>
                </div>
                <button onClick={() => setShowApplyLeave(false)} className="p-2 hover:bg-gray-100 rounded-xl">
                  <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleApplyLeave} className="space-y-4 mb-8">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Start Date</label>
                    <input
                      type="date"
                      required
                      className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      value={leaveData.start_date}
                      onChange={(e) => setLeaveData({ ...leaveData, start_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">End Date</label>
                    <input
                      type="date"
                      required
                      className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                      value={leaveData.end_date}
                      onChange={(e) => setLeaveData({ ...leaveData, end_date: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Reason for Leave</label>
                  <textarea
                    required
                    rows="3"
                    placeholder="Enter short reason here..."
                    className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-medium text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all resize-none"
                    value={leaveData.reason}
                    onChange={(e) => setLeaveData({ ...leaveData, reason: e.target.value })}
                  />
                </div>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-100 disabled:opacity-50"
                >
                  {actionLoading ? 'Submitting...' : 'Submit Application 🚀'}
                </button>
              </form>

              <div className="pt-6 border-t border-gray-100">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Your Recent Leave Requests</h4>
                <div className="space-y-3">
                  {leaveHistory.length > 0 ? (
                    leaveHistory.slice(0, 5).map((leave, idx) => (
                      <div key={idx} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex justify-between items-center group">
                        <div className="text-left">
                          <p className="text-[10px] font-black text-gray-500 uppercase tracking-tight">
                            {new Date(leave.start_date).toLocaleDateString()} - {new Date(leave.end_date).toLocaleDateString()}
                          </p>
                          <p className="text-xs font-bold text-gray-900 mt-0.5 line-clamp-1">{leave.reason}</p>
                        </div>
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${
                          leave.status === 'Approved' ? 'bg-green-100 text-green-700 border-green-200' :
                          leave.status === 'Rejected' ? 'bg-red-100 text-red-700 border-red-200' :
                          'bg-amber-100 text-amber-700 border-amber-200'
                        }`}>
                          {leave.status}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest text-center py-4 bg-gray-50 rounded-2xl border border-dashed border-gray-200">No leave requests found.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Detailed Payslip Modal */}
      {selectedPayslip && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[60] animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden relative border border-white/20">
            {/* Header with Pattern */}
            <div className="bg-indigo-600 p-8 text-white relative">
              <div className="relative z-10 text-center">
                <h2 className="text-3xl font-black uppercase tracking-tighter mb-1">SINDHUJA FINANCE</h2>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-80">Salary Payment Receipt</p>
              </div>
              {/* Decorative circles */}
              <div className="absolute top-[-20px] right-[-20px] w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
              <div className="absolute bottom-[-20px] left-[-20px] w-32 h-32 bg-indigo-400/20 rounded-full blur-2xl"></div>
            </div>

            <div className="p-8">
              {/* Receipt Info */}
              <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-100">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Billing Cycle</p>
                  <p className="text-lg font-black text-gray-900">{selectedPayslip.month_year}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</p>
                  <p className="text-sm font-black text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100 uppercase">{selectedPayslip.status || 'Paid'}</p>
                </div>
              </div>

              {/* Table Style Details */}
              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-gray-400">Staff Name</span>
                  <span className="font-black text-gray-800">{staff.name}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-gray-400">Staff ID</span>
                  <span className="font-mono font-black text-gray-800">{staff.staff_id}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-gray-400">Designation</span>
                  <span className="font-black text-gray-800 uppercase">{staff.role || 'Staff'}</span>
                </div>
                <div className="h-px bg-gray-100 my-4"></div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-gray-400">Days Present</span>
                  <span className="font-black text-gray-800">{selectedPayslip.present_days || 0} Days</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-gray-400">Gross Salary</span>
                  <span className="font-black text-gray-800">₹{selectedPayslip.gross_salary || selectedPayslip.base_salary}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-gray-400">Deductions</span>
                  <span className="font-black text-rose-500">- ₹{selectedPayslip.deductions || 0}</span>
                </div>
                <div className="h-px bg-gray-100 my-4 border-dashed"></div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-gray-900 uppercase">Net Pay Amount</span>
                  <span className="text-2xl font-black text-green-600">₹{selectedPayslip.net_salary}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    const docContent = `
                      SINDHUJA FINANCE
                      -----------------------------
                      PAYSLIP FOR ${selectedPayslip.month_year}
                      -----------------------------
                      Staff ID:     ${staff.staff_id}
                      Staff Name:   ${staff.name}
                      Designation:  ${staff.role || 'Staff'}

                      Present Days: ${selectedPayslip.present_days || 0}
                      Gross Salary: Rs. ${selectedPayslip.gross_salary || selectedPayslip.base_salary}
                      Deductions:   Rs. ${selectedPayslip.deductions || 0}
                      Net Salary:   Rs. ${selectedPayslip.net_salary}
                      Status:       ${selectedPayslip.status || 'Paid'}

                      Note: This is a computer-generated document.
                    `.trim().replace(/^ +/gm, '');

                    const blob = new Blob([docContent], { type: 'text/plain' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `Payslip_${staff.staff_id}_${selectedPayslip.month_year}.txt`;
                    link.click();
                  }}
                  className="py-4 bg-indigo-50 text-indigo-600 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-indigo-100 transition-all border border-indigo-100"
                >
                  Download
                </button>
                <button 
                  onClick={() => setSelectedPayslip(null)}
                  className="py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-800 transition-all"
                >
                  Close
                </button>
              </div>
              <p className="text-[8px] text-center text-gray-400 mt-6 font-bold uppercase tracking-widest">© Sindhuja Finance Management System</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StaffDashboard;
