const express = require('express');
const compression = require('compression');
const NodeCache = require('node-cache');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

const cache = new NodeCache({ stdTTL: 15 });
const flushCache = () => cache.flushAll();
const cacheMiddleware = (duration = 15) => (req, res, next) => {
  if (req.method !== 'GET') return next();
  const key = req.originalUrl;
  const cachedResponse = cache.get(key);
  if (cachedResponse) return res.json(cachedResponse);
  res.sendResponse = res.json;
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      cache.set(key, body, duration);
    }
    res.sendResponse(body);
  };
  next();
};

app.use(compression());
const http = require('http').createServer(app);
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'https://hr-attendance-ashy.vercel.app', // Deployed Frontend URL
  'http://localhost:5174', // Fallback local dev port 1
  'http://localhost:5175'  // Fallback local dev port 2
];

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    // or if the origin is from Vercel, localhost, or explicitly matches.
    if (!origin || 
        origin.includes('localhost') || 
        origin.includes('vercel.app') || 
        allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Blocked This Request'));
    }
  },
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  credentials: true
};

const io = require('socket.io')(http, {
  cors: corsOptions
});
const port = process.env.PORT || 5050;

// Global Error Handlers for Debugging
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🌊 UNHANDLED REJECTION:', reason);
  process.exit(1);
});

// Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());

app.use((req, res, next) => {
  res.on('finish', () => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && res.statusCode >= 200 && res.statusCode < 300) {
      flushCache();
    }
  });
  next();
});

app.use(fileUpload());

// In-memory store for live staff locations (pure real-time)
const liveStaffLocations = new Map();

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if(!supabaseUrl || !supabaseKey) {
  console.error("❌ CRITICAL: SUPABASE_URL or Auth Keys missing in .env!");
}
if(process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("🛡️ Backend using Service Role Key (RLS Bypassed)");
}

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

// GET /staff/locations → Consolidated endpoint for Live Tracker
app.get('/staff/locations', async (req, res) => {
  try {
    const liveLocations = Array.from(liveStaffLocations.values());
    if (liveLocations.length === 0) {
      const { data, error } = await supabase
        .from('staff_locations')
        .select('staff_id, latitude, longitude, timestamp, staff(name)')
        .order('timestamp', { ascending: false });
      if (error) throw error;
      const latestFromDB = [];
      const seen = new Set();
      data?.forEach(loc => {
        if (!seen.has(loc.staff_id)) {
          latestFromDB.push({ ...loc, name: loc.staff?.name || 'Unknown' });
          seen.add(loc.staff_id);
        }
      });
      return res.json(latestFromDB);
    }
    res.json(liveLocations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/staff/update-location', async (req, res) => {
  try {
    const { staff_id, name, latitude, longitude } = req.body;
    const locationData = { staff_id, name, latitude, longitude, timestamp: new Date().toISOString() };

    // 1. Update In-memory Map for real-time speed
    liveStaffLocations.set(staff_id, locationData);

    // 2. Broadcast via Socket.io
    io.emit('live-location-update', locationData);

    // 3. Save to Supabase for history/persistence
    await supabase.from('staff_locations').insert([{
      staff_id,
      latitude,
      longitude
    }]);

    res.json({ success: true });
  } catch (err) {
    console.error('Location Update Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('🔌 New real-time client connected');

  socket.on('staff-location-update', async (data) => {
    const locationData = { ...data, timestamp: new Date().toISOString() };

    // Update Map and Emit
    liveStaffLocations.set(data.staff_id, locationData);
    io.emit('live-location-update', locationData);

    // Save to DB
    try {
      await supabase.from('staff_locations').insert([{
        staff_id: data.staff_id,
        latitude: data.latitude,
        longitude: data.longitude
      }]);
    } catch (e) {
      console.error('Socket Location DB Save Error:', e.message);
    }
  });
});

// STAFF PORTAL ENDPOINTS
app.post('/staff/login', async (req, res) => {
  try {
    const { staff_id, password } = req.body;
    console.log(`🔑 Login attempt for: ${staff_id}`);
    const { data: staff, error } = await supabase.from('staff').select('*').ilike('staff_id', staff_id).single();
    if (error || !staff || staff.password !== password) {
      console.log(`❌ Login failed for ID: ${staff_id}. DB Match: ${!!staff}, Password Match: ${staff?.password === password}`);
      return res.status(401).json({ error: 'Invalid Staff ID or password' });
    }
    console.log(`✅ Login successful for ${staff_id}`);
    res.json({ message: 'Login successful', staff });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/staff/change-password', async (req, res) => {
  try {
    const { staff_id, newPassword } = req.body;
    const { data, error } = await supabase.from('staff').update({ password: newPassword, is_password_set: true }).eq('staff_id', staff_id).select().single();
    if (error) throw error;
    res.json({ message: 'Success', staff: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/staff/attendance/check-in', async (req, res) => {
    try {
        const { staff_id, latitude, longitude } = req.body;
        const offset = 5.5 * 60 * 60 * 1000; // IST Offset
        const today = new Date(Date.now() + offset).toISOString().split('T')[0];
        
        const { data: existing } = await supabase.from('staff_attendance')
            .select('*').eq('staff_id', staff_id).eq('date', today).single();
        
        if (existing) {
            return res.status(400).json({ error: 'You have already checked in today.' });
        }

        const { data, error } = await supabase.from('staff_attendance').insert([{
            staff_id, date: today, check_in: new Date().toISOString(), check_in_lat: latitude, check_in_lng: longitude, status: 'present'
        }]).select().single();
        
        if (error) {
            console.error('❌ Check-in DB Error:', error);
            throw error;
        }
        res.json({ message: 'Success', attendance: data });
    } catch (err) { 
        console.error('❌ Check-in Error:', err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/staff/attendance/check-out', async (req, res) => {
    try {
        const { staff_id, latitude, longitude } = req.body;
        const offset = 5.5 * 60 * 60 * 1000; // IST Offset
        const today = new Date(Date.now() + offset).toISOString().split('T')[0];

        const { data, error } = await supabase.from('staff_attendance').update({ 
            check_out: new Date().toISOString(), check_out_lat: latitude, check_out_lng: longitude 
        }).eq('staff_id', staff_id).eq('date', today).select().single();
        
        if (error) {
            console.error('❌ Check-out DB Error:', error);
            throw error;
        }
        res.json({ message: 'Success', attendance: data });
    } catch (err) { 
        console.error('❌ Check-out Error:', err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/staff/attendance/status/:staff_id', async (req, res) => {
    const offset = 5.5 * 60 * 60 * 1000; // IST Offset
    const today = new Date(Date.now() + offset).toISOString().split('T')[0];
    const { data } = await supabase.from('staff_attendance').select('*').eq('staff_id', req.params.staff_id).eq('date', today).single();
    res.json(data || null);
});

app.get('/staff/attendance/history/:staff_id', async (req, res) => {
    try {
        const { staff_id } = req.params;
        
        // Calculate the 1st day of the current month in IST
        const { month, year } = req.query; // Optional: ?month=5&year=2026
        
        const istNow = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
        const currentMonth = istNow.getMonth() + 1;
        const currentYear = istNow.getFullYear();

        const targetMonth = month ? parseInt(month) : currentMonth;
        const targetYear = year ? parseInt(year) : currentYear;

        const dateLimit = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
        
        // Calculate end of the selected month
        const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1;
        const nextYear = targetMonth === 12 ? targetYear + 1 : targetYear;
        const nextMonthLimit = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
        
        // 1. Fetch Actual Attendance (Current Month Only)
        const { data: attendanceData, error: attError } = await supabase
            .from('staff_attendance')
            .select('*')
            .eq('staff_id', staff_id)
            .gte('date', dateLimit)
            .lt('date', nextMonthLimit);
            
        if (attError) throw attError;

        // 2. Fetch Leave Applications (Current Month Only)
        const { data: leaveData, error: leaveError } = await supabase
            .from('staff_leaves')
            .select('*')
            .eq('staff_id', staff_id)
            .gte('end_date', dateLimit)
            .lte('start_date', nextMonthLimit);
            
        if (leaveError) {
            // If table doesn't exist, we might get an error. 
            // In that case, just return attendance data.
            console.warn("⚠️ Could not fetch leaves for history (table might be missing or locked).");
            return res.json(attendanceData || []);
        }

        const combinedHistory = [...(attendanceData || [])];
        const existingDates = new Set(attendanceData.map(a => a.date));

        // 3. Process Leaves into daily entries
        leaveData?.forEach(leave => {
            let start = new Date(leave.start_date);
            let end = new Date(leave.end_date);
            
            // Iterate through every day of the leave
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                
                // Only add leave record if no actual check-in exists for that day AND it's in current month
                if (!existingDates.has(dateStr) && dateStr >= dateLimit) {
                    combinedHistory.push({
                        id: `leave-${leave.id}-${dateStr}`,
                        date: dateStr,
                        staff_id: staff_id,
                        check_in: null,
                        check_out: null,
                        status: leave.status === 'Approved' ? 'LEAVE' : 
                                leave.status === 'Rejected' ? 'REJECTED' : 'PENDING LEAVE',
                        is_leave: true
                    });
                }
            }
        });

        // 4. Sort by date Descending and apply a final foolproof filter for the selected month
        const finalHistory = combinedHistory
            .filter(item => item.date >= dateLimit && item.date < nextMonthLimit)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(finalHistory);
    } catch (err) {
        console.error('❌ History Fetch Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/staff/profile/:staff_id', async (req, res) => {
    const { data } = await supabase.from('staff').select('*').eq('staff_id', req.params.staff_id).single();
    res.json(data || null);
});

// Fetch Staff Payslips
app.get('/staff/payslips/:staff_id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('salary_payments')
            .select('*')
            .eq('staff_id', req.params.staff_id)
            .order('month_year', { ascending: false });
        
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('❌ Payslips Fetch Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Police Verification Upload
app.post('/staff/upload-verification', async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ error: 'No files were uploaded.' });
        }

        const { staff_id } = req.body;
        const uploadFile = req.files.verificationFile;
        const fileExt = uploadFile.name.split('.').pop();
        const fileName = `${staff_id}_verification_${Date.now()}.${fileExt}`;

        // 1. Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('verification')
            .upload(fileName, uploadFile.data, {
                contentType: uploadFile.mimetype
            });

        if (uploadError) {
          console.error('❌ Supabase Storage Error:', uploadError);
          return res.status(500).json({ error: `Storage Error: ${uploadError.message}. Did you create the 'verification' bucket?` });
        }

        // 2. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('verification')
            .getPublicUrl(fileName);

        // 3. Update Staff Table
        const { error: updateError } = await supabase
            .from('staff')
            .update({ police_verification_url: publicUrl })
            .eq('staff_id', staff_id);

        if (updateError) {
          console.error('❌ DB Update Error:', updateError);
          return res.status(500).json({ error: `Database Error: ${updateError.message}` });
        }

        res.json({ message: 'Success', url: publicUrl });
    } catch (err) {
        console.error('❌ Upload Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// LEAVE APPLICATION ENDPOINTS
app.post('/staff/leave/apply', async (req, res) => {
    try {
        const { staff_id, start_date, end_date, reason } = req.body;
        const { data, error } = await supabase
            .from('staff_leaves')
            .insert([{
                staff_id,
                start_date,
                end_date,
                reason,
                status: 'Pending'
            }])
            .select()
            .single();

        if (error) throw error;
        res.json({ message: 'Leave application submitted successfully', leave: data });
    } catch (err) {
        console.error('❌ Leave Application Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/staff/leave/history/:staff_id', async (req, res) => {
    try {
        const { month, year } = req.query;
        const istNow = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
        const currentMonth = istNow.getMonth() + 1;
        const currentYear = istNow.getFullYear();

        const targetMonth = month ? parseInt(month) : currentMonth;
        const targetYear = year ? parseInt(year) : currentYear;

        const dateLimit = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
        const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1;
        const nextYear = targetMonth === 12 ? targetYear + 1 : targetYear;
        const nextMonthLimit = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

        const { data, error } = await supabase
            .from('staff_leaves')
            .select('*')
            .eq('staff_id', req.params.staff_id)
            .gte('end_date', dateLimit)
            .lte('start_date', nextMonthLimit)
            .order('start_date', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error('❌ Leave History Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

http.listen(port, async () => {
    console.log(`🚀 Staff Backend starting on port ${port}...`);
    try {
        if (!supabaseUrl || !supabaseKey) {
            console.warn("⚠️ Supabase credentials missing, skipping initial connection check.");
            return;
        }
        const { count, error } = await supabase.from('staff').select('*', { count: 'exact', head: true });
        if (error) {
            console.error('❌ Supabase Connection Check Error:', error.message);
        } else {
            console.log(`✅ Supabase Connected. Staff Count: ${count || 0}`);
        }
    } catch (e) { 
        console.error('💥 Supabase Init Critical Error:', e.message); 
    }
    console.log("🏁 Startup Sequence Complete.");
});
