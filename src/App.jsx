import { useEffect, useMemo, useRef, useState } from "react";
import { hasSupabaseConfig, supabase } from "./supabaseClient";
import categoriesSeed from "./data/categories.json";
import ordersSeed from "./data/orders.json";

const PRODUCT_IMAGE_BUCKET = import.meta.env.VITE_SUPABASE_PRODUCT_IMAGE_BUCKET || "product-images";
const ROLE_USER = "user";
const ROLE_ADMIN = "admin";
const ROLE_FETCH_TIMEOUT_MS = 4000;
const ORDER_STATUSES = ["Placed", "Processing", "Shipped", "Delivered", "Cancelled"];

async function ensureUserProfile(authUser) {
  if (!supabase || !authUser?.id) return;

  const profilePayload = {
    id: authUser.id,
    email: authUser.email ?? null
  };

  const { error } = await supabase.from("profiles").upsert(profilePayload, { onConflict: "id" });
  if (error) {
    console.error("Failed to ensure profile:", error.message);
  }
}

async function getUserRole(authUser) {
  if (!supabase || !authUser?.id) return ROLE_USER;

  const { data, error } = await supabase.from("profiles").select("role").eq("id", authUser.id).maybeSingle();
  if (error) {
    console.error("Failed to load role:", error.message);
    return ROLE_USER;
  }

  if (!data) {
    await ensureUserProfile(authUser);
    return ROLE_USER;
  }

  return String(data.role || ROLE_USER).toLowerCase() === ROLE_ADMIN ? ROLE_ADMIN : ROLE_USER;
}

async function getUserRoleWithTimeout(authUser, timeoutMs = ROLE_FETCH_TIMEOUT_MS) {
  const fallbackRole = ROLE_USER;
  let timeoutId;

  try {
    return await Promise.race([
      getUserRole(authUser),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`Role lookup timed out after ${timeoutMs}ms. Falling back to '${fallbackRole}'.`);
          resolve(fallbackRole);
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
}

function normalizeProduct(product) {
  return {
    ...product,
    id: String(product.id),
    price: Number(product.price) || 0
  };
}

function normalizeCategory(category) {
  return {
    id: String(category.id),
    name: String(category.name || "").trim()
  };
}

function normalizeOrder(order, fallback = {}) {
  return {
    id: String(order.id),
    status: ORDER_STATUSES.includes(order.status) ? order.status : "Placed",
    date: order.order_date || order.date || new Date().toISOString().slice(0, 10),
    total: Number(order.total) || 0,
    items: Number(order.items_count ?? order.items) || 0,
    userId: order.user_id || fallback.userId || null,
    userEmail: order.profiles?.email || fallback.userEmail || "Unknown"
  };
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

function Storefront({ user, userRole, onLogout }) {
  const [activeTab, setActiveTab] = useState("products");
  const [categories, setCategories] = useState(() =>
    hasSupabaseConfig && supabase ? [] : categoriesSeed.map(normalizeCategory)
  );
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cartItems, setCartItems] = useState([]);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [newProductImageFile, setNewProductImageFile] = useState(null);

  const [adminSection, setAdminSection] = useState("add-product");
  const [adminOrderSearch, setAdminOrderSearch] = useState("");
  const [adminOrderStatusFilter, setAdminOrderStatusFilter] = useState("All");
  const [adminOrderDateFilter, setAdminOrderDateFilter] = useState("");
  const [adminOrderSort, setAdminOrderSort] = useState("newest");
  const [adminProductSearch, setAdminProductSearch] = useState("");

  const [adminMessage, setAdminMessage] = useState("");
  const [orderMessage, setOrderMessage] = useState("");
  const [categoriesLoading, setCategoriesLoading] = useState(() => hasSupabaseConfig && Boolean(supabase));
  const [productsLoading, setProductsLoading] = useState(() => hasSupabaseConfig && Boolean(supabase));
  const [ordersLoading, setOrdersLoading] = useState(false);

  const productImageInputRef = useRef(null);
  const isAdmin = userRole === ROLE_ADMIN;
  const categoryOptions = useMemo(() => [{ id: "all", name: "All" }, ...categories], [categories]);

  useEffect(() => {
    if (!newProductCategory && categories.length > 0) {
      setNewProductCategory(categories[0].name);
    }
  }, [categories, newProductCategory]);

  useEffect(() => {
    if (selectedCategory === "All") return;
    const exists = categories.some((category) => category.name === selectedCategory);
    if (!exists) {
      setSelectedCategory("All");
    }
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (!isAdmin && activeTab === "admin") {
      setActiveTab("products");
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    let active = true;

    const loadCategories = async () => {
      if (!hasSupabaseConfig || !supabase) {
        setCategories(categoriesSeed.map(normalizeCategory));
        setCategoriesLoading(false);
        return;
      }

      setCategoriesLoading(true);
      const { data, error } = await supabase.from("categories").select("id, name").order("name", { ascending: true });

      if (!active) return;
      if (error) {
        setAdminMessage(`Supabase category fetch failed: ${error.message}`);
        setCategoriesLoading(false);
        return;
      }

      setCategories((data || []).map(normalizeCategory));
      setCategoriesLoading(false);
    };

    loadCategories();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadProducts = async () => {
      if (!hasSupabaseConfig || !supabase) {
        setProductsLoading(false);
        return;
      }

      setProductsLoading(true);
      const { data, error } = await supabase
        .from("products")
        .select("id, name, category, price, rating, badge, description, color, image")
        .order("id", { ascending: false });

      if (!active) return;
      if (error) {
        setAdminMessage(`Supabase product fetch failed: ${error.message}`);
        setProductsLoading(false);
        return;
      }

      setProducts((data || []).map(normalizeProduct));
      setProductsLoading(false);
    };

    loadProducts();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadOrders = async () => {
      const fallback = ordersSeed.map((order) => normalizeOrder(order, { userId: user.id, userEmail: user.email }));

      if (!hasSupabaseConfig || !supabase) {
        if (active) {
          setOrders(fallback);
          setOrdersLoading(false);
        }
        return;
      }

      setOrdersLoading(true);
      let query = supabase
        .from("orders")
        .select("id, user_id, status, order_date, total, items_count, created_at, profiles:user_id(email)")
        .order("created_at", { ascending: false });

      if (!isAdmin) {
        query = query.eq("user_id", user.id);
      }

      const { data, error } = await query;
      if (!active) return;

      if (error) {
        setOrderMessage(`Supabase order fetch failed: ${error.message}`);
        setOrders(fallback);
        setOrdersLoading(false);
        return;
      }

      setOrders((data || []).map((order) => normalizeOrder(order, { userEmail: user.email })));
      setOrdersLoading(false);
    };

    loadOrders();

    return () => {
      active = false;
    };
  }, [isAdmin, user.email, user.id]);

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

  const myOrders = useMemo(() => {
    return orders.filter((order) => !order.userId || order.userId === user.id);
  }, [orders, user.id]);

  const adminOrders = useMemo(() => {
    if (!isAdmin) return [];

    const query = adminOrderSearch.trim().toLowerCase();
    const filtered = orders.filter((order) => {
      const statusMatch = adminOrderStatusFilter === "All" || order.status === adminOrderStatusFilter;
      const dateMatch = !adminOrderDateFilter || order.date === adminOrderDateFilter;
      const searchMatch =
        query.length === 0 ||
        order.id.toLowerCase().includes(query) ||
        order.userEmail.toLowerCase().includes(query);
      return statusMatch && dateMatch && searchMatch;
    });

    return filtered.sort((a, b) => {
      const left = new Date(a.date).getTime();
      const right = new Date(b.date).getTime();
      return adminOrderSort === "oldest" ? left - right : right - left;
    });
  }, [adminOrderDateFilter, adminOrderSearch, adminOrderSort, adminOrderStatusFilter, isAdmin, orders]);

  const adminOrderStats = useMemo(() => {
    if (!isAdmin) {
      return { totalOrders: 0, pendingOrders: 0, totalRevenue: 0 };
    }

    return {
      totalOrders: orders.length,
      pendingOrders: orders.filter((order) => ["Placed", "Processing", "Shipped"].includes(order.status)).length,
      totalRevenue: orders.reduce((sum, order) => sum + order.total, 0)
    };
  }, [isAdmin, orders]);

  const adminVisibleProducts = useMemo(() => {
    const query = adminProductSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) => {
      return product.name.toLowerCase().includes(query) || product.category.toLowerCase().includes(query);
    });
  }, [adminProductSearch, products]);

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

  const placeOrder = async () => {
    if (cartSummary.rows.length === 0) return;

    setOrderMessage("");
    const orderDraft = {
      status: "Placed",
      date: new Date().toISOString().slice(0, 10),
      total: cartSummary.subtotal,
      items: cartSummary.rows.reduce((sum, row) => sum + row.qty, 0),
      userId: user.id,
      userEmail: user.email
    };

    if (hasSupabaseConfig && supabase) {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          user_id: user.id,
          status: orderDraft.status,
          order_date: orderDraft.date,
          total: orderDraft.total,
          items_count: orderDraft.items
        })
        .select("id, user_id, status, order_date, total, items_count, profiles:user_id(email)")
        .single();

      if (error) {
        setOrderMessage(`Failed to place order: ${error.message}`);
        return;
      }

      setOrders((prev) => [normalizeOrder(data, { userId: user.id, userEmail: user.email }), ...prev]);
    } else {
      const localOrder = normalizeOrder(
        {
          id: `o-${Date.now().toString().slice(-6)}`,
          status: orderDraft.status,
          date: orderDraft.date,
          total: orderDraft.total,
          items: orderDraft.items
        },
        { userId: user.id, userEmail: user.email }
      );
      setOrders((prev) => [localOrder, ...prev]);
    }

    setCartItems([]);
    setOrderMessage("Order placed successfully.");
    setActiveTab("orders");
  };

  const addCategory = async (event) => {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;

    const exists = categories.some((category) => category.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      setAdminMessage("Category already exists.");
      return;
    }

    if (hasSupabaseConfig && supabase) {
      const { data, error } = await supabase.from("categories").insert({ name }).select("id, name").single();
      if (error) {
        if (error.code === "23505") {
          setAdminMessage("Category already exists.");
        } else {
          setAdminMessage(`Failed to save category in Supabase: ${error.message}`);
        }
        return;
      }

      setCategories((prev) => [...prev, normalizeCategory(data)].sort((a, b) => a.name.localeCompare(b.name)));
    } else {
      const newCategory = { id: `cat-${Date.now()}`, name };
      setCategories((prev) => [...prev, newCategory].sort((a, b) => a.name.localeCompare(b.name)));
    }

    setNewProductCategory(name);
    setNewCategoryName("");
    setAdminMessage("Category added.");
  };

  const removeCategory = async (categoryId) => {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;

    const hasProducts = products.some((product) => product.category === category.name);
    if (hasProducts) {
      setAdminMessage("Cannot delete a category that is used by existing products.");
      return;
    }

    if (hasSupabaseConfig && supabase) {
      const { error } = await supabase.from("categories").delete().eq("id", categoryId);
      if (error) {
        setAdminMessage(`Failed to remove category: ${error.message}`);
        return;
      }
    }

    const remainingCategories = categories.filter((item) => item.id !== categoryId);
    setCategories(remainingCategories);
    if (selectedCategory === category.name) {
      setSelectedCategory("All");
    }
    if (newProductCategory === category.name) {
      setNewProductCategory(remainingCategories[0]?.name || "");
    }
    setAdminMessage("Category removed.");
  };

  const addProduct = async (event) => {
    event.preventDefault();
    const name = newProductName.trim();
    const description = newProductDescription.trim();
    const price = Number(newProductPrice);

    if (!name || !newProductCategory || !description || !Number.isFinite(price) || price <= 0) {
      setAdminMessage("Fill all product fields with valid values.");
      return;
    }

    if (newProductImageFile && (!hasSupabaseConfig || !supabase)) {
      setAdminMessage("Supabase must be configured to upload product images.");
      return;
    }

    let uploadedImageUrl = null;
    if (newProductImageFile && supabase) {
      const extension = newProductImageFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeExtension = extension.replace(/[^a-z0-9]/g, "") || "jpg";
      const imagePath = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExtension}`;
      const { error: uploadError } = await supabase.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .upload(imagePath, newProductImageFile, { cacheControl: "3600", upsert: false });

      if (uploadError) {
        setAdminMessage(`Image upload failed: ${uploadError.message}`);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(imagePath);
      uploadedImageUrl = publicUrlData?.publicUrl || null;
    }

    const newProduct = normalizeProduct({
      id: `p-${Date.now()}`,
      name,
      category: newProductCategory,
      price,
      rating: 4.5,
      badge: "New",
      description,
      color: "#2563eb",
      image: uploadedImageUrl
    });

    if (hasSupabaseConfig && supabase) {
      const { data, error } = await supabase
        .from("products")
        .insert({
          name,
          category: newProductCategory,
          price,
          rating: 4.5,
          badge: "New",
          description,
          color: "#2563eb",
          image: uploadedImageUrl
        })
        .select("id, name, category, price, rating, badge, description, color, image")
        .single();

      if (error) {
        setAdminMessage(`Failed to save product in Supabase: ${error.message}`);
        return;
      }

      setProducts((prev) => [normalizeProduct(data), ...prev]);
    } else {
      setProducts((prev) => [newProduct, ...prev]);
    }

    setNewProductName("");
    setNewProductPrice("");
    setNewProductDescription("");
    setNewProductImageFile(null);
    if (productImageInputRef.current) {
      productImageInputRef.current.value = "";
    }
    setAdminMessage("Product added successfully.");
  };

  const removeProduct = async (productId) => {
    setAdminMessage("");

    if (hasSupabaseConfig && supabase) {
      const { error } = await supabase.from("products").delete().eq("id", productId);
      if (error) {
        setAdminMessage(`Failed to remove product: ${error.message}`);
        return;
      }
    }

    setProducts((prev) => prev.filter((product) => product.id !== productId));
    setAdminMessage("Product removed.");
  };

  const updateOrderStatus = async (orderId, nextStatus) => {
    if (!ORDER_STATUSES.includes(nextStatus)) return;

    if (hasSupabaseConfig && supabase) {
      const { error } = await supabase.from("orders").update({ status: nextStatus }).eq("id", orderId);
      if (error) {
        setAdminMessage(`Failed to update order status: ${error.message}`);
        return;
      }
    }

    setOrders((prev) => prev.map((order) => (order.id === String(orderId) ? { ...order, status: nextStatus } : order)));
    setAdminMessage("Order status updated.");
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
              {categoriesLoading
                ? Array.from({ length: 5 }).map((_, index) => <span key={index} className="chip-skeleton" aria-hidden="true" />)
                : categoryOptions.map((category) => (
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
              {productsLoading
                ? Array.from({ length: 6 }).map((_, index) => (
                    <article key={index} className="product-card product-card-skeleton" aria-hidden="true">
                      <div className="product-media skeleton-block" />
                      <div className="product-body">
                        <span className="skeleton-line skeleton-chip" />
                        <span className="skeleton-line skeleton-title" />
                        <span className="skeleton-line skeleton-meta" />
                        <span className="skeleton-line skeleton-price" />
                      </div>
                    </article>
                  ))
                : filteredProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={cartQtyById[product.id] || 0}
                      onIncrease={increaseQty}
                      onDecrease={decreaseQty}
                    />
                  ))}
              {!productsLoading && filteredProducts.length === 0 && <p className="empty-state">No products found.</p>}
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
            {orderMessage && <p className="status">{orderMessage}</p>}
          </section>
        )}

        {activeTab === "orders" && (
          <section className="section-block">
            <h2>My Orders</h2>
            {ordersLoading && <p className="empty-state">Loading orders...</p>}
            <div className="order-list">
              {myOrders.map((order) => (
                <article key={order.id} className="order-row">
                  <div>
                    <strong>{order.id}</strong>
                    <p>
                      {order.items} items • {order.date}
                    </p>
                  </div>
                  <div className="cart-right">
                    <span>{order.status}</span>
                    <strong>{formatCurrency(order.total)}</strong>
                  </div>
                </article>
              ))}
              {!ordersLoading && myOrders.length === 0 && <p className="empty-state">No orders yet.</p>}
            </div>
            {orderMessage && <p className="status">{orderMessage}</p>}
          </section>
        )}

        {activeTab === "admin" && isAdmin && (
          <section className="section-block">
            <h2>Admin Portal</h2>
            <p className="muted">Choose an action and manage products/orders in one place.</p>

            <div className="admin-toolbar">
              <label htmlFor="admin-section">Admin Action</label>
              <select
                id="admin-section"
                value={adminSection}
                onChange={(event) => {
                  setAdminSection(event.target.value);
                  setAdminMessage("");
                }}
              >
                <option value="add-product">Add Product</option>
                <option value="view-orders">View All Orders</option>
                <option value="manage-products">Manage Products</option>
              </select>
            </div>

            {adminSection === "add-product" && (
              <>
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
                    {categories.map((category) => (
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

                  <label htmlFor="product-image">Product Image</label>
                  <input
                    id="product-image"
                    ref={productImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(event) => setNewProductImageFile(event.target.files?.[0] || null)}
                  />

                  <button className="btn" type="submit">
                    Add Product
                  </button>
                </form>

                <div className="order-list">
                  {categories.map((category) => (
                    <article key={category.id} className="order-row order-row-admin">
                      <div>
                        <strong>{category.name}</strong>
                      </div>
                      <button className="btn btn-danger" type="button" onClick={() => removeCategory(category.id)}>
                        Delete
                      </button>
                    </article>
                  ))}
                  {categories.length === 0 && <p className="empty-state">No categories available.</p>}
                </div>
              </>
            )}

            {adminSection === "view-orders" && (
              <>
                <div className="admin-stat-grid">
                  <article className="admin-stat-card">
                    <span>Total Orders</span>
                    <strong>{adminOrderStats.totalOrders}</strong>
                  </article>
                  <article className="admin-stat-card">
                    <span>Open Orders</span>
                    <strong>{adminOrderStats.pendingOrders}</strong>
                  </article>
                  <article className="admin-stat-card">
                    <span>Total Revenue</span>
                    <strong>{formatCurrency(adminOrderStats.totalRevenue)}</strong>
                  </article>
                </div>

                <div className="admin-filter-grid">
                  <input
                    type="search"
                    placeholder="Search by order ID or email"
                    value={adminOrderSearch}
                    onChange={(event) => setAdminOrderSearch(event.target.value)}
                  />
                  <select value={adminOrderStatusFilter} onChange={(event) => setAdminOrderStatusFilter(event.target.value)}>
                    <option value="All">All Statuses</option>
                    {ORDER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={adminOrderDateFilter}
                    onChange={(event) => setAdminOrderDateFilter(event.target.value)}
                  />
                  <select value={adminOrderSort} onChange={(event) => setAdminOrderSort(event.target.value)}>
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>

                {ordersLoading && <p className="empty-state">Loading orders...</p>}
                <div className="order-list">
                  {adminOrders.map((order) => (
                    <article key={order.id} className="order-row order-row-admin">
                      <div>
                        <strong>{order.id}</strong>
                        <p>
                          {order.userEmail} • {order.items} items • {order.date}
                        </p>
                      </div>
                      <div className="order-admin-right">
                        <strong>{formatCurrency(order.total)}</strong>
                        <select value={order.status} onChange={(event) => updateOrderStatus(order.id, event.target.value)}>
                          {ORDER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  ))}
                  {!ordersLoading && adminOrders.length === 0 && <p className="empty-state">No orders match the filters.</p>}
                </div>
              </>
            )}

            {adminSection === "manage-products" && (
              <>
                <input
                  type="search"
                  placeholder="Search products by name or category"
                  value={adminProductSearch}
                  onChange={(event) => setAdminProductSearch(event.target.value)}
                />
                <div className="order-list">
                  {adminVisibleProducts.map((product) => (
                    <article key={product.id} className="order-row order-row-admin">
                      <div>
                        <strong>{product.name}</strong>
                        <p>
                          {product.category} • {formatCurrency(product.price)}
                        </p>
                      </div>
                      <button className="btn btn-danger" type="button" onClick={() => removeProduct(product.id)}>
                        Delete
                      </button>
                    </article>
                  ))}
                  {adminVisibleProducts.length === 0 && <p className="empty-state">No products match the search.</p>}
                </div>
              </>
            )}

            {adminMessage && <p className="status">{adminMessage}</p>}
          </section>
        )}

        {activeTab === "profile" && (
          <section className="section-block">
            <h2>Profile</h2>
            <p className="muted">Signed in as: {user.phone || user.email || "Unknown user"}</p>
            <p className="muted">Role: {userRole}</p>
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
        {isAdmin && (
          <button
            className={activeTab === "admin" ? "nav-btn active" : "nav-btn"}
            onClick={() => setActiveTab("admin")}
            type="button"
          >
            Admin
          </button>
        )}
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(ROLE_USER);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const canSubmitAuth = useMemo(() => {
    const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    return hasValidEmail && password.trim().length >= 6;
  }, [email, password]);

  useEffect(() => {
    let mounted = true;
    if (!hasSupabaseConfig || !supabase) {
      setAuthReady(true);
      return () => {
        mounted = false;
      };
    }

    const bootstrapSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        console.error("Failed to restore session:", error.message);
      }
      const currentUser = data.session?.user ?? null;
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser) {
        const role = await getUserRoleWithTimeout(currentUser);
        if (!mounted) return;
        setUserRole(role);
      } else {
        setUserRole(ROLE_USER);
      }
    };

    bootstrapSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser) {
        setUserRole(ROLE_USER);
        const role = await getUserRoleWithTimeout(currentUser);
        if (!mounted) return;
        setUserRole(role);
      } else {
        setUserRole(ROLE_USER);
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const submitAuth = async (event) => {
    event.preventDefault();
    setMessage("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage("Enter a valid email address.");
      return;
    }
    if (password.trim().length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }
    if (!hasSupabaseConfig || !supabase) {
      setMessage("Missing Supabase config. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const authPayload = { email: normalizedEmail, password };
      const { data, error } = isSignUp
        ? await supabase.auth.signUp(authPayload)
        : await supabase.auth.signInWithPassword(authPayload);
      if (error) throw error;

      if (isSignUp && data.user) {
        await ensureUserProfile(data.user);
      }

      if (isSignUp && !data.session) {
        setMessage("Account created. Confirm your email, then sign in.");
      } else {
        setMessage(isSignUp ? "Account created and signed in." : "Signed in successfully.");
      }
    } catch (error) {
      setMessage(error?.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setUserRole(ROLE_USER);
    setEmail("");
    setPassword("");
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
    return <Storefront user={user} userRole={userRole} onLogout={handleLogout} />;
  }

  return (
    <main className="app-shell">
      <section className="auth-card">
        <div className="login-head">
          <h1>Streamline</h1>
          <p className="subtitle">{isSignUp ? "Create account" : "Login with email and password"}</p>
        </div>

        <form onSubmit={submitAuth} className="form-block">
          <label htmlFor="email">Email Address</label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={6}
            required
          />

          <button className="btn" type="submit" disabled={!canSubmitAuth || loading}>
            {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
          </button>

          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setIsSignUp((prev) => !prev);
              setMessage("");
            }}
            disabled={loading}
          >
            {isSignUp ? "Have an account? Sign In" : "New here? Create Account"}
          </button>
        </form>

        {message && <div className="status">{message}</div>}
      </section>
    </main>
  );
}



