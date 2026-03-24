require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');
const webpush = require('web-push');
const escpos = require('escpos');
escpos.Network = require('escpos-network');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*", methods: ["GET", "POST"] } 
});
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// Cấu hình Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS
app.use(cors({
  origin: ['https://duca-mocha.vercel.app', 'https://menu-duca.vercel.app', 'http://localhost:19006', 'http://localhost:8081', '*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Connect MongoDB Atlas
mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB Atlas connected!');
    await initVAPID();
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ─── Schemas ─────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['nhan_vien', 'chu'], required: true },
  },
  { timestamps: true }
);

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    nameEn: { type: String, default: '' },
    price: { type: Number, required: true },
    category: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const orderSchema = new mongoose.Schema(
  {
    items: [
      {
        menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
        name: String,
        price: Number,
        quantity: Number,
      },
    ],
    total: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    createdByEmail: String,
    tableNumber: { type: Number, default: 0 },
    billId: String,
  },
  { timestamps: true }
);

const counterSchema = new mongoose.Schema({
  id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const activeCartSchema = new mongoose.Schema({
  tableNumber: { type: Number, unique: true, required: true },
  items: [
    {
      menuItemId: String,
      name: String,
      price: Number,
      quantity: Number,
      imageUrl: String,
    },
  ],
  updatedByEmail: String,
}, { timestamps: true });

const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

const pushSubSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: String, auth: String },
  email: String,
  role: String,
}, { timestamps: true });

// ─── Models ──────────────────────────────────────────────────────────────────
const User      = mongoose.model('User', userSchema);
const MenuItem  = mongoose.model('MenuItem', menuItemSchema);
const Order     = mongoose.model('Order', orderSchema);
const Counter   = mongoose.model('Counter', counterSchema);
const ActiveCart = mongoose.model('ActiveCart', activeCartSchema);
const Config    = mongoose.model('Config', configSchema);
const PushSub   = mongoose.model('PushSub', pushSubSchema);

// ─── Socket.io Logic ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[Socket] New client connected:', socket.id);
  
  socket.on('join_shop', () => {
    socket.join('shop_room');
    console.log(`[Socket] Client ${socket.id} joined shop_room`);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected');
  });
});

// ─── Printer Helper ──────────────────────────────────────────────────────────
const removeAccents = (str) => {
  if (!str) return '';
  return str.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
};

const printOrderToShop = async (order) => {
  return new Promise(async (resolve) => {
    try {
      const config = await Config.findOne({ key: 'shop_public_ip' });
      if (!config || !config.value) {
        console.log('[Printer] Shop Public IP not found.');
        return resolve({ success: false, message: 'Chưa có IP quán' });
      }
      const publicIp = config.value;
      const device = new escpos.Network(publicIp, 9100);
      const options = { encoding: "GB18030" };
      const printer = new escpos.Printer(device, options);

      const items = order.items || [];
      const subTotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
      const discount = order.discount || 0;
      const total = order.total || (subTotal - discount);
      const staffEmail = order.createdByEmail ? order.createdByEmail.split('@')[0] : 'N/A';

      // Set timeout for connection
      const timeout = setTimeout(() => {
        console.warn(`[Printer] Connection timeout to ${publicIp}`);
        resolve({ success: false, message: `Máy in (${publicIp}) không phản hồi (Timeout)` });
      }, 8000);

      device.open((err) => {
        clearTimeout(timeout);
        if (err) {
          console.error('[Printer] Connection error:', err.message);
          return resolve({ success: false, message: 'Lỗi: ' + err.message });
        }
        
        printer
          .font('a').align('ct').style('b').size(1, 1).text('DU CA')
          .size(0, 0).text('COFFEE CAFE & MILKTEA')
          .text('15 Huynh Ngoc Hue, Tan An, Hoi An')
          .text('Hotline: 0905 941 552')
          .control('LF')
          .text('------------------------------------------')
          .align('ct').style('b').size(1, 1)
          .text(' .----------. ')
          .text(` |  BAN ${order.tableNumber || '?'}   | `)
          .text(' \'----------\' ')
          .size(0, 0).style('b').text('PHIEU TINH TIEN')
          .text(`ID: HD#${order.billId || order._id.toString().slice(-6)}`)
          .control('LF')
          .style('normal').align('lt')
          .text(`Ngay: ${new Date(order.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}      Gio: ${new Date(order.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}`)
          .text('------------------------------------------')
          .tableCustom([
            { text: "Ten hang", align: "LEFT", width: 0.40 },
            { text: "D Gia", align: "RIGHT", width: 0.20 },
            { text: "SL", align: "CENTER", width: 0.10 },
            { text: "T.Tien", align: "RIGHT", width: 0.30 }
          ]);

        items.forEach(it => {
          printer.tableCustom([
            { text: removeAccents(it.name), align: "LEFT", width: 0.40 },
            { text: it.price.toLocaleString(), align: "RIGHT", width: 0.20 },
            { text: it.quantity.toString(), align: "CENTER", width: 0.10 },
            { text: (it.price * it.quantity).toLocaleString(), align: "RIGHT", width: 0.30 }
          ]);
        });

        printer.text('------------------------------------------').align('lt')
          .tableCustom([
            { text: "Tong tien hang:", align: "LEFT", width: 0.6 },
            { text: subTotal.toLocaleString(), align: "RIGHT", width: 0.4 }
          ])
          .tableCustom([
            { text: "Chiet khau:", align: "LEFT", width: 0.6 },
            { text: discount.toLocaleString(), align: "RIGHT", width: 0.4 }
          ])
          .style('b').size(0, 0)
          .tableCustom([
            { text: "TONG CONG:", align: "LEFT", width: 0.6 },
            { text: `${total.toLocaleString()} d`, align: "RIGHT", width: 0.4 }
          ])
          .style('normal')
          .control('LF')
          .text(`NVTN: ${staffEmail}`)
          .control('LF')
          .align('ct')
          .text('Cam On Quy Khach & Hen Gap Lai!!!')
          .text('Wifi: ilovemusic')
          .feed(3).cut().close();
        
        console.log('[Printer] Detailed Bill sent successfully.');
        resolve({ success: true, message: 'Đã in hóa đơn thành công ✅' });
      });
    } catch (error) {
      console.warn('[Printer] Bill generation failed:', error.message);
      resolve({ success: false, message: error.message });
    }
  });
};

// ─── VAPID Setup ─────────────────────────────────────────────────────────────
let vapidPublicKey  = process.env.VAPID_PUBLIC_KEY  || '';
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';

async function initVAPID() {
  try {
    if (!vapidPublicKey || !vapidPrivateKey) {
      const cfg = await Config.findOne({ key: 'vapid' });
      if (cfg) {
        vapidPublicKey  = cfg.value.publicKey;
        vapidPrivateKey = cfg.value.privateKey;
      } else {
        const keys = webpush.generateVAPIDKeys();
        vapidPublicKey  = keys.publicKey;
        vapidPrivateKey = keys.privateKey;
        await Config.create({ key: 'vapid', value: keys });
        console.log('🔑 VAPID keys generated – thêm vào Railway env:');
        console.log('VAPID_PUBLIC_KEY=' + vapidPublicKey);
        console.log('VAPID_PRIVATE_KEY=' + vapidPrivateKey);
      }
    }
    webpush.setVapidDetails('mailto:admin@duca.vn', vapidPublicKey, vapidPrivateKey);
    console.log('✅ VAPID ready');
  } catch (e) {
    console.error('❌ VAPID init error:', e.message);
  }
}

// Gửi push đến tất cả admin (role: chu)
async function notifyAdmins(payload) {
  try {
    const subs = await PushSub.find({ role: 'chu' });
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
      } catch (e) {
        // Xóa subscription hết hạn
        if (e.statusCode === 410 || e.statusCode === 404) {
          await PushSub.deleteOne({ _id: sub._id });
        }
      }
    }));
  } catch (e) {
    console.error('Push notify error:', e.message);
  }
}

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// ─── Upload ảnh lên Cloudinary ───────────────────────────────────────────────
app.post('/upload', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ message: 'Thiếu dữ liệu ảnh' });

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({
        message: 'Lỗi cấu hình Cloudinary trên server (thiếu biến môi trường)',
        missing: {
          name: !process.env.CLOUDINARY_CLOUD_NAME,
          key: !process.env.CLOUDINARY_API_KEY,
          secret: !process.env.CLOUDINARY_API_SECRET
        }
      });
    }

    const result = await cloudinary.uploader.upload(data, {
      folder: 'duca-menu',
      transformation: [{ width: 600, crop: 'limit', quality: 'auto:good', fetch_format: 'auto' }],
    });

    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({
      message: 'Upload ảnh thất bại: ' + (err.message || 'Lỗi không xác định'),
      details: err.error_code || err.name
    });
  }
});

// ─── Auth ────────────────────────────────────────────────────────────────────
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu' });
    }

    const user = await User.findOne({ email, password });
    if (!user) {
      return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
    }

    return res.json({
      message: 'Đăng nhập thành công',
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Menu ────────────────────────────────────────────────────────────────────
app.get('/menu', async (req, res) => {
  try {
    const { page = 1, limit = 6, q, category } = req.query;
    let query = { isActive: true };

    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { nameEn: { $regex: q, $options: 'i' } }
      ];
    }

    if (category && category !== 'all') {
      const catQuery = {
        $or: [
          { category: category },
          { categoryName: category },
          { categoryTitle: category },
          { type: category }
        ]
      };
      if (query.$or && query.$or.length > 0) {
        query = { $and: [{ $or: query.$or }, catQuery] };
      } else {
        query = catQuery;
      }
    }

    const total = await MenuItem.countDocuments(query);
    const items = await MenuItem.find(query)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .select('-__v');

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    res.json({
      items,
      total,
      hasMore: (parseInt(page) * parseInt(limit)) < total,
      page: parseInt(page)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.post('/menu', async (req, res) => {
  try {
    const { name, nameEn, price, imageUrl, category } = req.body;
    if (!name || typeof price !== 'number') {
      return res.status(400).json({ message: 'Tên món và giá là bắt buộc' });
    }
    const item = await MenuItem.create({ name, nameEn, price, imageUrl, category });
    res.set('Cache-Control', 'no-store');
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.put('/menu/:id', async (req, res) => {
  try {
    const { name, nameEn, price, isActive, imageUrl, category } = req.body;
    const item = await MenuItem.findByIdAndUpdate(
      req.params.id,
      { name, nameEn, price, isActive, imageUrl, category },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });
    res.set('Cache-Control', 'no-store');
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.patch('/menu/:id', async (req, res) => {
  try {
    const updates = req.body;
    const item = await MenuItem.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });
    res.set('Cache-Control', 'no-store');
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.delete('/menu/:id', async (req, res) => {
  try {
    await MenuItem.findByIdAndDelete(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Categories ──────────────────────────────────────────────────────────────
app.get('/categories', async (req, res) => {
  try {
    const categories = await MenuItem.distinct('category', { isActive: true });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.json(categories.filter(Boolean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Orders ──────────────────────────────────────────────────────────────────
app.post('/orders', async (req, res) => {
  try {
    const { items, createdByEmail, tableNumber, discount = 0, total: sentTotal } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Đơn hàng không có món' });
    }

    // Tăng số thứ tự hóa đơn
    const counter = await Counter.findOneAndUpdate(
      { id: 'order_number' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const billSeq = counter.seq.toString().padStart(6, '0');
    const billId = billSeq;

    // Dùng total từ client (đã trừ chiết khấu) hoặc tính lại
    const subTotal = items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
    const total = (typeof sentTotal === 'number') ? sentTotal : Math.max(0, subTotal - (discount || 0));

    const newOrder = new Order({
      items,
      total,
      discount: discount || 0,
      createdByEmail: createdByEmail || null,
      tableNumber: tableNumber || 0,
      billId,
    });
    await newOrder.save();

    // Notify all admins/chu via push
    notifyAdmins({ order: newOrder });

    // In bill qua mạng (ESC/POS thermal printer) + Socket.io
    const printResult = await printOrderToShop(newOrder);
    io.to('shop_room').emit('print_trigger', newOrder);

    res.status(201).json({ 
      message: 'Order created', 
      order: newOrder,
      printStatus: printResult 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Table Management ─────────────────────────────────────────────────────────
app.get('/tables', async (req, res) => {
  try {
    const activeCarts = await ActiveCart.find();
    const tables = [];
    for (let i = 1; i <= 10; i++) {
      const cart = activeCarts.find(c => c.tableNumber === i);
      const total = cart ? cart.items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0) : 0;
      tables.push({
        number: i,
        isBusy: !!cart && cart.items.length > 0,
        itemCount: cart ? cart.items.length : 0,
        total,
      });
    }
    return res.json(tables);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy trạng thái bàn' });
  }
});

app.get('/tables/:num/cart', async (req, res) => {
  try {
    const tableNum = parseInt(req.params.num);
    const cart = await ActiveCart.findOne({ tableNumber: tableNum });
    return res.json(cart || { tableNumber: tableNum, items: [] });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi lấy giỏ hàng bàn' });
  }
});

app.post('/tables/:num/cart', async (req, res) => {
  try {
    const tableNum = parseInt(req.params.num);
    const { items, updatedByEmail } = req.body;
    const cart = await ActiveCart.findOneAndUpdate(
      { tableNumber: tableNum },
      { items, updatedByEmail, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    return res.json(cart);
  } catch (err) {
    res.status(500).json({ message: 'Lỗi cập nhật giỏ hàng bàn' });
  }
});

app.delete('/tables/:num/cart', async (req, res) => {
  try {
    const tableNum = parseInt(req.params.num);
    await ActiveCart.deleteOne({ tableNumber: tableNum });
    return res.json({ message: 'Đã xóa giỏ hàng bàn ' + tableNum });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi xóa giỏ hàng bàn' });
  }
});

app.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 6, email, date } = req.query;
    let query = {};
    if (email) query.createdByEmail = email;
    if (date) {
      const start = new Date(`${date}T00:00:00+07:00`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: start, $lt: end };
    }

    const total = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const stats = await Order.aggregate([
      { $match: query },
      { $group: { _id: null, sum: { $sum: '$total' } } }
    ]);
    const dayTotal = stats.length > 0 ? stats[0].sum : 0;

    res.set('Cache-Control', 'no-store');
    res.json({
      items: orders,
      total,
      dayTotal,
      hasMore: (parseInt(page) * parseInt(limit)) < total,
      page: parseInt(page)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Xuất bill ra CSV
app.get('/orders/export-csv', async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    let query = {};

    if (type === 'daily') {
      const dateStr = String(req.query.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ message: 'Ngày không hợp lệ' });
      }
      const start = new Date(`${dateStr}T00:00:00+07:00`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      query = { createdAt: { $gte: start, $lt: end } };
    } else if (type === 'monthly') {
      const monthStr = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(monthStr)) {
        return res.status(400).json({ message: 'Tháng không hợp lệ' });
      }
      const [yearStr, monthPart] = monthStr.split('-');
      const year = Number(yearStr);
      const month = Number(monthPart);
      const start = new Date(`${yearStr}-${monthPart.padStart(2, '0')}-01T00:00:00+07:00`);
      const end = new Date(year, month, 1);
      // For cross-month correctly in server local time vs Vietnam time, 
      // it is safer to use the same logic:
      const endD = new Date(start);
      endD.setMonth(endD.getMonth() + 1);
      query = { createdAt: { $gte: start, $lt: endD } };
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });

    const header = ['orderId', 'createdAt', 'nhanVien', 'tenMon', 'soLuong', 'donGia', 'thanhTien'];
    const rows = [header.join(',')];

    orders.forEach(order => {
      const d = order.createdAt ? new Date(order.createdAt) : null;
      let createdAt = '';
      if (d && !isNaN(d.getTime())) {
        // Use a format without commas for CSV safety
        const pad = (v) => v.toString().padStart(2, '0');
        // Convert to GMT+7 (shorthand for Vietnam)
        const vnDate = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        createdAt = `${vnDate.getUTCFullYear()}-${pad(vnDate.getUTCMonth() + 1)}-${pad(vnDate.getUTCDate())} ${pad(vnDate.getUTCHours())}:${pad(vnDate.getUTCMinutes())}:${pad(vnDate.getUTCSeconds())}`;
      }
      const nhanVien = order.createdByEmail || '';

      (order.items || []).forEach(it => {
        const soLuong = it.quantity || 0;
        const donGia = it.price || 0;
        rows.push([
          `"${order._id.toString()}"`,
          `"${createdAt}"`,
          `"${nhanVien}"`,
          `"${(it.name || '').replace(/"/g, '""')}"`,
          soLuong,
          donGia,
          soLuong * donGia,
        ].join(','));
      });
    });

    res.set('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Push Notifications ──────────────────────────────────────────────────────
// Trả về VAPID public key cho client
app.get('/push/vapid-public-key', (req, res) => {
  if (!vapidPublicKey) return res.status(503).json({ message: 'VAPID chưa sẵn sàng' });
  res.json({ publicKey: vapidPublicKey });
});

// Lưu subscription của client
app.post('/push/subscribe', async (req, res) => {
  const { subscription, email, role } = req.body;
  try {
    await PushSub.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      { ...subscription, email, role },
      { upsert: true, new: true }
    );
    res.status(201).json({ message: 'Subscribed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update Shop IP for direct printing
app.post('/config/shop-ip', async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ message: 'IP is required' });
  try {
    await Config.findOneAndUpdate(
      { key: 'shop_public_ip' },
      { value: ip },
      { upsert: true, new: true }
    );
    console.log('[Config] Store Public IP updated to:', ip);
    res.json({ message: 'Shop IP updated', ip });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Xóa subscription khi logout
app.post('/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) await PushSub.deleteOne({ endpoint });
    res.json({ message: 'Đã xóa subscription' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// ─── Revenue ─────────────────────────────────────────────────────────────────
app.get('/revenue', async (req, res) => {
  try {
    const result = await Order.aggregate([
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } },
    ]);
    const totalRevenue = result.length ? result[0].totalRevenue : 0;
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=10');
    res.json({ totalRevenue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.get('/revenue/export-csv', async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    const orders = [];

    if (type === 'daily') {
      const dateStr = String(req.query.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ message: 'Ngày không hợp lệ' });
      }
      const start = new Date(`${dateStr}T00:00:00+07:00`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      orders.push(...(await Order.find({ createdAt: { $gte: start, $lt: end } })));
      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const csv = ['type,date,billsCount,totalRevenue', `daily,${dateStr},${orders.length},${totalRevenue}`].join('\n');
      res.set('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-daily-${dateStr}.csv"`);
      return res.send(csv);
    }

    if (type === 'monthly') {
      const monthStr = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(monthStr)) {
        return res.status(400).json({ message: 'Tháng không hợp lệ' });
      }
      const [yearStr, monthPart] = monthStr.split('-');
      const year = Number(yearStr);
      const month = Number(monthPart);
      const start = new Date(`${yearStr}-${monthPart.padStart(2, '0')}-01T00:00:00+07:00`);
      const endD = new Date(start);
      endD.setMonth(endD.getMonth() + 1);
      orders.push(...(await Order.find({ createdAt: { $gte: start, $lt: endD } })));
      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
      const csv = ['type,month,billsCount,totalRevenue', `monthly,${monthStr},${orders.length},${totalRevenue}`].join('\n');
      res.set('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="revenue-monthly-${monthStr}.csv"`);
      return res.send(csv);
    }

    return res.status(400).json({ message: 'type phải là daily hoặc monthly' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Manual print trigger
app.post('/orders/:id/print', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order nout found' });
    const printResult = await printOrderToShop(order);
    // Also trigger via Socket for the Print Hub at the shop
    io.to('shop_room').emit('print_trigger', order);
    res.json({ printStatus: printResult });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
