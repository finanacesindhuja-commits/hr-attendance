const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
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
    const { data } = await supabase.from('staff_attendance').select('*').eq('staff_id', req.params.staff_id).order('date', { ascending: false });
    res.json(data || []);
});

app.get('/staff/profile/:staff_id', async (req, res) => {
    const { data } = await supabase.from('staff').select('*').eq('staff_id', req.params.staff_id).single();
    res.json(data || null);
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
