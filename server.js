require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cấu hình CORS chi tiết hơn
app.use(cors({
  origin: ['https://duca-mocha.vercel.app', 'https://menu-duca.vercel.app', 'http://localhost:19006', 'http://localhost:8081', '*'], // Thêm các origin phổ biến
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Connect MongoDB Atlas
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Atlas connected!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// User model đơn giản
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
    createdByEmail: String,
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
const MenuItem = mongoose.model('MenuItem', menuItemSchema);
const Order = mongoose.model('Order', orderSchema);

// Test route
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// API đăng ký với mã theo role (lưu DB)
app.post('/register', async (req, res) => {
  try {
    const { email, password, role, code } = req.body;

    if (!email || !password || !role || !code) {
      return res.status(400).json({ message: 'Vui lòng nhập đầy đủ thông tin' });
    }

    if (role === 'nhan_vien' && code !== '2507') {
      return res
        .status(400)
        .json({ message: 'Mã xác thực nhân viên không đúng (phải là 2507)' });
    }

    if (role === 'chu' && code !== '250704') {
      return res
        .status(400)
        .json({ message: 'Mã xác thực chủ không đúng (phải là 250704)' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email đã được sử dụng' });
    }

    const user = await User.create({ email, password, role });

    return res.status(201).json({
      message: 'Đăng ký thành công',
      user: { id: user._id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

// Đăng nhập đơn giản
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

// Lấy menu cho nhân viên / chủ (có phân trang và lọc)
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
      query.$or = query.$or || [];
      // Lọc theo nhiều trường category có thể có
      const catQuery = {
        $or: [
          { category: category },
          { categoryName: category },
          { categoryTitle: category },
          { type: category }
        ]
      };
      if (query.$or.length > 0) {
        query = { $and: [{ $or: query.$or }, catQuery] };
      } else {
        query = catQuery;
      }
    }

    const total = await MenuItem.countDocuments(query);
    const items = await MenuItem.find(query)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: 1 });

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

// Thêm món (cho chủ)
app.post('/menu', async (req, res) => {
  try {
    const { name, nameEn, price, imageUrl, category } = req.body;
    if (!name || typeof price !== 'number') {
      return res.status(400).json({ message: 'Tên món và giá là bắt buộc' });
    }
    const item = await MenuItem.create({ name, nameEn, price, imageUrl, category });
    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Sửa món
app.put('/menu/:id', async (req, res) => {
  try {
    const { name, nameEn, price, isActive, imageUrl, category } = req.body;
    const item = await MenuItem.findByIdAndUpdate(
      req.params.id,
      { name, nameEn, price, isActive, imageUrl, category },
      { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Xóa món
app.delete('/menu/:id', async (req, res) => {
  try {
    await MenuItem.findByIdAndDelete(req.params.id);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Lấy danh sách danh mục duy nhất
app.get('/categories', async (req, res) => {
  try {
    const categories = await MenuItem.distinct('category', { isActive: true });
    // Lọc bỏ null/empty và trả về
    res.json(categories.filter(Boolean));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Lấy danh sách user (nhân viên) với phân trang
app.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 6, role = 'nhan_vien' } = req.query;
    const query = { role };
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password') // Không trả về mật khẩu
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    res.json({
      items: users,
      total,
      hasMore: (parseInt(page) * parseInt(limit)) < total,
      page: parseInt(page)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Tạo order (nhân viên xác nhận order, lưu doanh thu)
app.post('/orders', async (req, res) => {
  try {
    const { items, createdByEmail } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Order phải có ít nhất 1 món' });
    }

    const total = items.reduce(
      (sum, it) => sum + (it.price || 0) * (it.quantity || 1),
      0
    );

    const order = await Order.create({
      items,
      total,
      createdByEmail: createdByEmail || null,
    });

    return res.status(201).json({
      message: 'Tạo order thành công',
      order,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Danh sách order (quản lý bill) với phân trang và lọc
app.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 6, email, date } = req.query;
    let query = {};
    
    if (email) {
      query.createdByEmail = email;
    }
    
    if (date) {
      // date format: YYYY-MM-DD
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      query.createdAt = { $gte: start, $lt: end };
    }

    const total = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    res.json({
      items: orders,
      total,
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
    const orders = await Order.find().sort({ createdAt: -1 });

    const header = [
      'orderId',
      'createdAt',
      'nhanVien',
      'tenMon',
      'soLuong',
      'donGia',
      'thanhTien',
    ];

    const rows = [header.join(',')];

    orders.forEach(order => {
      const createdAt = order.createdAt
        ? new Date(order.createdAt).toISOString()
        : '';
      const nhanVien = order.createdByEmail || '';

      (order.items || []).forEach(it => {
        const soLuong = it.quantity || 0;
        const donGia = it.price || 0;
        const thanhTien = soLuong * donGia;

        const cols = [
          `"${order._id.toString()}"`,
          `"${createdAt}"`,
          `"${nhanVien}"`,
          `"${(it.name || '').replace(/"/g, '""')}"`,
          soLuong,
          donGia,
          thanhTien,
        ];

        rows.push(cols.join(','));
      });
    });

    const csv = rows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="orders-export.csv"'
    );
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Tổng doanh thu
app.get('/revenue', async (req, res) => {
  try {
    const result = await Order.aggregate([
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } },
    ]);
    const totalRevenue = result.length ? result[0].totalRevenue : 0;
    res.json({ totalRevenue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

// Xuất doanh thu ra CSV theo ngày/tháng
// Query:
// - type=daily&date=YYYY-MM-DD
// - type=monthly&month=YYYY-MM
app.get('/revenue/export-csv', async (req, res) => {
  try {
    const type = String(req.query.type || '').toLowerCase();
    const orders = [];

    if (type === 'daily') {
      const dateStr = String(req.query.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ message: 'Ngày không hợp lệ' });
      }

      const start = new Date(`${dateStr}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      orders.push(...(await Order.find({ createdAt: { $gte: start, $lt: end } })));

      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

      const header = ['type', 'date', 'billsCount', 'totalRevenue'];
      const row = [`daily`, dateStr, orders.length, totalRevenue];
      const csv = [header.join(','), row.join(',')].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="revenue-daily-${dateStr}.csv"`
      );
      return res.send(csv);
    }

    if (type === 'monthly') {
      const monthStr = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(monthStr)) {
        return res.status(400).json({ message: 'Tháng không hợp lệ' });
      }

      const [yearStr, monthPart] = monthStr.split('-');
      const year = Number(yearStr);
      const month = Number(monthPart); // 1..12

      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);

      orders.push(
        ...(await Order.find({ createdAt: { $gte: start, $lt: end } }))
      );

      const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

      const header = ['type', 'month', 'billsCount', 'totalRevenue'];
      const row = [`monthly`, monthStr, orders.length, totalRevenue];
      const csv = [header.join(','), row.join(',')].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="revenue-monthly-${monthStr}.csv"`
      );
      return res.send(csv);
    }

    return res
      .status(400)
      .json({ message: 'type phải là daily hoặc monthly' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

