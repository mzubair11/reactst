import { useEffect, useMemo, useState } from "react";
import {
  RecaptchaVerifier,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut
} from "firebase/auth";
import { auth } from "./firebase";
import categoriesSeed from "./data/categories.json";
import productsSeed from "./data/products.json";
import ordersSeed from "./data/orders.json";

let recaptchaVerifierInstance = null;

function normalizePhone(value) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

function ProductCard({ product, quantity, onIncrease, onDecrease }) {
  return (
    <article className="product-card">
      <div className="product-media" style={{ background: product.color || "#2563eb" }}>
        {product.image ? (
          <img src={product.image} alt={product.name} loading="lazy" />
        ) : (
          <span>{product.category}</span>
        )}
        <button className="wish-btn" type="button" aria-label="Save product">
          ♡
        </button>
        {quantity > 0 ? (
          <div className="image-qty-control" role="group" aria-label={`Quantity for ${product.name}`}>
            <button type="button" onClick={() => onDecrease(product.id)}>
              -
            </button>
            <span>{quantity}</span>
            <button type="button" onClick={() => onIncrease(product.id)}>
              +
            </button>
          </div>
        ) : (
          <button className="image-add-btn" type="button" onClick={() => onIncrease(product.id)}>
            ADD
          </button>
        )}
      </div>
      <div className="product-body">
        <p className="product-chip">{product.category}</p>
        <h3>{product.name}</h3>
        <p className="product-meta">{product.description}</p>
        <strong>{formatCurrency(product.price)}</strong>
      </div>
    </article>
  );
}

function Storefront({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState("products");
  const [categories, setCategories] = useState([{ id: "all", name: "All" }, ...categoriesSeed]);
  const [products, setProducts] = useState(productsSeed);
  const [orders, setOrders] = useState(ordersSeed);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cartItems, setCartItems] = useState([]);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductCategory, setNewProductCategory] = useState(categoriesSeed[0]?.name || "");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [adminMessage, setAdminMessage] = useState("");

  useEffect(() => {
    if (!newProductCategory && categories.length > 1) {
      setNewProductCategory(categories[1].name);
    }
  }, [categories, newProductCategory]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const categoryMatch = selectedCategory === "All" || product.category === selectedCategory;
      const queryMatch =
        query.length === 0 ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query);
      return categoryMatch && queryMatch;
    });
  }, [products, search, selectedCategory]);

  const cartSummary = useMemo(() => {
    const grouped = cartItems.reduce((acc, id) => {
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});

    const rows = Object.entries(grouped)
      .map(([id, qty]) => {
        const product = products.find((item) => item.id === id);
        if (!product) return null;
        return {
          id,
          name: product.name,
          price: product.price,
          qty,
          total: product.price * qty
        };
      })
      .filter(Boolean);

    const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
    return { rows, subtotal };
  }, [cartItems, products]);

  const cartQtyById = useMemo(() => {
    return cartItems.reduce((acc, id) => {
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});
  }, [cartItems]);

  const handleAddToCart = (id) => {
    setCartItems((prev) => [...prev, id]);
  };

  const increaseQty = (id) => {
    setCartItems((prev) => [...prev, id]);
  };

  const decreaseQty = (id) => {
    setCartItems((prev) => {
      const index = prev.indexOf(id);
      if (index < 0) return prev;
      return [...prev.slice(0, index), ...prev.slice(index + 1)];
    });
  };

  const placeOrder = () => {
    if (cartSummary.rows.length === 0) return;
    const newOrder = {
      id: `o-${Date.now().toString().slice(-6)}`,
      status: "Placed",
      date: new Date().toISOString().slice(0, 10),
      total: cartSummary.subtotal,
      items: cartSummary.rows.reduce((sum, row) => sum + row.qty, 0)
    };
    setOrders((prev) => [newOrder, ...prev]);
    setCartItems([]);
    setActiveTab("orders");
  };

  const addCategory = (event) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;

    const exists = categories.some((category) => category.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      setAdminMessage("Category already exists.");
      return;
    }

    const newCategory = { id: `cat-${Date.now()}`, name };
    setCategories((prev) => [...prev, newCategory]);
    setNewProductCategory(name);
    setNewCategoryName("");
    setAdminMessage("Category added.");
  };

  const addProduct = (event) => {
    event.preventDefault();
    const name = newProductName.trim();
    const description = newProductDescription.trim();
    const price = Number(newProductPrice);

    if (!name || !newProductCategory || !description || !Number.isFinite(price) || price <= 0) {
      setAdminMessage("Fill all product fields with valid values.");
      return;
    }

    const newProduct = {
      id: `p-${Date.now()}`,
      name,
      category: newProductCategory,
      price,
      rating: 4.5,
      badge: "New",
      description,
      color: "#2563eb"
    };

    setProducts((prev) => [newProduct, ...prev]);
    setNewProductName("");
    setNewProductPrice("");
    setNewProductDescription("");
    setAdminMessage("Product added successfully.");
  };

  return (
    <main className="store-shell">
      <header className="top-header">
        <div>
          <h1>Streamline</h1>
          <p>Simple Product Ordering</p>
        </div>
        <button className="btn btn-mini" onClick={onLogout} type="button">
          Logout
        </button>
      </header>

      <section className="store-content">
        {activeTab === "products" && (
          <>
            <section className="search-panel">
              <input
                type="search"
                placeholder="Search products"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </section>

            <div className="chip-row" role="tablist" aria-label="Categories">
              {categories.map((category) => (
                <button
                  key={category.id}
                  className={selectedCategory === category.name ? "chip active" : "chip"}
                  onClick={() => setSelectedCategory(category.name)}
                  type="button"
                >
                  {category.name}
                </button>
              ))}
            </div>

            <div className="product-list">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={cartQtyById[product.id] || 0}
                  onIncrease={increaseQty}
                  onDecrease={decreaseQty}
                />
              ))}
              {filteredProducts.length === 0 && <p className="empty-state">No products found.</p>}
            </div>
          </>
        )}

        {activeTab === "cart" && (
          <section className="section-block">
            <div className="section-title-row">
              <h2>Cart</h2>
              <span>{cartSummary.rows.length} products</span>
            </div>
            <div className="cart-list">
              {cartSummary.rows.map((item) => (
                <article key={item.id} className="cart-row">
                  <div>
                    <h3>{item.name}</h3>
                    <p>{formatCurrency(item.price)}</p>
                  </div>
                  <div className="cart-right">
                    <div className="qty-row">
                      <button className="btn btn-ghost qty-btn" onClick={() => decreaseQty(item.id)} type="button">
                        -
                      </button>
                      <span>{item.qty}</span>
                      <button className="btn btn-ghost qty-btn" onClick={() => increaseQty(item.id)} type="button">
                        +
                      </button>
                    </div>
                    <strong>{formatCurrency(item.total)}</strong>
                  </div>
                </article>
              ))}
              {cartSummary.rows.length === 0 && <p className="empty-state">Your cart is empty.</p>}
            </div>
            <div className="checkout-box">
              <div>
                <p>Total</p>
                <strong>{formatCurrency(cartSummary.subtotal)}</strong>
              </div>
              <button className="btn" type="button" onClick={placeOrder} disabled={cartSummary.rows.length === 0}>
                Place Order
              </button>
            </div>
          </section>
        )}

        {activeTab === "orders" && (
          <section className="section-block">
            <h2>My Orders</h2>
            <div className="order-list">
              {orders.map((order) => (
                <article key={order.id} className="order-row">
                  <div>
                    <strong>{order.id}</strong>
                    <p>{order.items} items</p>
                  </div>
                  <div className="cart-right">
                    <span>{order.status}</span>
                    <strong>{formatCurrency(order.total)}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "admin" && (
          <section className="section-block">
            <h2>Admin Portal</h2>
            <p className="muted">Add categories and products here.</p>

            <form className="form-block" onSubmit={addCategory}>
              <label htmlFor="category">New Category</label>
              <input
                id="category"
                type="text"
                value={newCategoryName}
                placeholder="Category name"
                onChange={(event) => setNewCategoryName(event.target.value)}
              />
              <button className="btn" type="submit">
                Add Category
              </button>
            </form>

            <form className="form-block" onSubmit={addProduct}>
              <label htmlFor="product-name">Product Name</label>
              <input
                id="product-name"
                type="text"
                value={newProductName}
                placeholder="Product name"
                onChange={(event) => setNewProductName(event.target.value)}
              />

              <label htmlFor="product-category">Category</label>
              <select
                id="product-category"
                value={newProductCategory}
                onChange={(event) => setNewProductCategory(event.target.value)}
              >
                {categories
                  .filter((category) => category.name !== "All")
                  .map((category) => (
                    <option key={category.id} value={category.name}>
                      {category.name}
                    </option>
                  ))}
              </select>

              <label htmlFor="product-price">Price</label>
              <input
                id="product-price"
                type="number"
                min="1"
                step="1"
                value={newProductPrice}
                placeholder="Price"
                onChange={(event) => setNewProductPrice(event.target.value)}
              />

              <label htmlFor="product-description">Description</label>
              <input
                id="product-description"
                type="text"
                value={newProductDescription}
                placeholder="Short description"
                onChange={(event) => setNewProductDescription(event.target.value)}
              />

              <button className="btn" type="submit">
                Add Product
              </button>
            </form>

            {adminMessage && <p className="status">{adminMessage}</p>}
          </section>
        )}

        {activeTab === "profile" && (
          <section className="section-block">
            <h2>Profile</h2>
            <p className="muted">Signed in as: {user.phoneNumber}</p>
          </section>
        )}
      </section>

      <nav className="mobile-nav" aria-label="Primary">
        <button
          className={activeTab === "products" ? "nav-btn active" : "nav-btn"}
          onClick={() => setActiveTab("products")}
          type="button"
        >
          Products
        </button>
        <button className={activeTab === "cart" ? "nav-btn active" : "nav-btn"} onClick={() => setActiveTab("cart")} type="button">
          Cart ({cartItems.length})
        </button>
        <button className={activeTab === "orders" ? "nav-btn active" : "nav-btn"} onClick={() => setActiveTab("orders")} type="button">
          Orders
        </button>
        <button className={activeTab === "admin" ? "nav-btn active" : "nav-btn"} onClick={() => setActiveTab("admin")} type="button">
          Admin
        </button>
        <button
          className={activeTab === "profile" ? "nav-btn active" : "nav-btn"}
          onClick={() => setActiveTab("profile")}
          type="button"
        >
          Profile
        </button>
      </nav>
    </main>
  );
}

export default function App() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const canSendOtp = useMemo(() => normalizePhone(phone).length === 10, [phone]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });

    return unsubscribe;
  }, []);

  const setupRecaptcha = () => {
    if (recaptchaVerifierInstance) return recaptchaVerifierInstance;

    const container = document.getElementById("recaptcha-container");
    if (container) container.innerHTML = "";

    recaptchaVerifierInstance = new RecaptchaVerifier(auth, "recaptcha-container", {
      size: "invisible",
      callback: () => {}
    });

    return recaptchaVerifierInstance;
  };

  const sendOtp = async (event) => {
    event.preventDefault();
    setMessage("");
    const localNumber = normalizePhone(phone);
    if (localNumber.length !== 10) {
      setMessage("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      const verifier = setupRecaptcha();
      const phoneNumber = `+91${localNumber}`;
      const result = await signInWithPhoneNumber(auth, phoneNumber, verifier);
      setConfirmation(result);
      setMessage("OTP sent. Enter the code you received.");
    } catch (error) {
      setMessage(error?.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (event) => {
    event.preventDefault();
    if (!confirmation) return;
    setMessage("");
    setLoading(true);
    try {
      const result = await confirmation.confirm(otp);
      setUser(result.user);
      setMessage("Login successful.");
    } catch (error) {
      setMessage(error?.message || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setOtp("");
    setPhone("");
    setConfirmation(null);
    setMessage("Logged out.");
  };

  if (!authReady) {
    return (
      <main className="app-shell">
        <section className="auth-card">
          <p className="subtitle">Checking session...</p>
        </section>
      </main>
    );
  }

  if (user) {
    return <Storefront user={user} onLogout={handleLogout} />;
  }

  return (
    <main className="app-shell">
      <section className="auth-card">
        <div className="login-head">
          <h1>Streamline</h1>
          <p className="subtitle">Login with mobile number</p>
        </div>

        {!confirmation && (
          <form onSubmit={sendOtp} className="form-block">
            <label htmlFor="phone">Mobile Number</label>
            <div className="phone-input-group">
              <span className="country-code">+91</span>
              <input
                id="phone"
                type="tel"
                placeholder="Enter 10-digit number"
                value={phone}
                onChange={(e) => setPhone(normalizePhone(e.target.value))}
                autoComplete="tel"
                inputMode="numeric"
                maxLength={10}
                required
              />
            </div>
            <button className="btn" type="submit" disabled={!canSendOtp || loading}>
              {loading ? "Sending..." : "Send OTP"}
            </button>
          </form>
        )}

        {confirmation && (
          <form onSubmit={verifyOtp} className="form-block">
            <label htmlFor="otp">Enter OTP</label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              required
            />
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
          </form>
        )}

        {message && <div className="status">{message}</div>}
        <div id="recaptcha-container" />
      </section>
    </main>
  );
}
