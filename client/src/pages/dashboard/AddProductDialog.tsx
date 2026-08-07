import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface ProductRow {
  title: string;
  sku: string;
  price: string;
  category: string;
  vendor: string;
  shopifyProductId: string;
}

const DEFAULT_PRODUCTS: ProductRow[] = [
  {
    title: "Wireless Bluetooth Earbuds",
    sku: "ELEC-001",
    price: "49.99",
    category: "Electronics",
    vendor: "SoundMax",
    shopifyProductId: "B0-ELEC-001",
  },
  {
    title: "USB-C Hub 7-in-1",
    sku: "ELEC-002",
    price: "34.99",
    category: "Electronics",
    vendor: "ConnectPro",
    shopifyProductId: "B0-ELEC-002",
  },
  {
    title: "Mechanical Keyboard RGB",
    sku: "ELEC-003",
    price: "89.99",
    category: "Electronics",
    vendor: "KeyMaster",
    shopifyProductId: "B0-ELEC-003",
  },
  {
    title: '27" 4K IPS Monitor',
    sku: "ELEC-004",
    price: "299.99",
    category: "Electronics",
    vendor: "ViewSharp",
    shopifyProductId: "B0-ELEC-004",
  },
  {
    title: "Ergonomic Wireless Mouse",
    sku: "ELEC-005",
    price: "45.99",
    category: "Electronics",
    vendor: "ClickEase",
    shopifyProductId: "B0-ELEC-005",
  },
  {
    title: "10000mAh Power Bank",
    sku: "ELEC-006",
    price: "29.99",
    category: "Electronics",
    vendor: "ChargeUp",
    shopifyProductId: "B0-ELEC-006",
  },
  {
    title: "Smart WiFi LED Bulb 4-Pack",
    sku: "ELEC-007",
    price: "24.99",
    category: "Electronics",
    vendor: "BrightHome",
    shopifyProductId: "B0-ELEC-007",
  },
  {
    title: "Noise Cancelling Headphones",
    sku: "ELEC-008",
    price: "149.99",
    category: "Electronics",
    vendor: "SoundCore",
    shopifyProductId: "B0-ELEC-008",
  },
  {
    title: "Portable SSD 1TB",
    sku: "ELEC-009",
    price: "79.99",
    category: "Electronics",
    vendor: "DataSpeed",
    shopifyProductId: "B0-ELEC-009",
  },
  {
    title: "Webcam 1080p HD",
    sku: "ELEC-010",
    price: "59.99",
    category: "Electronics",
    vendor: "ClearView",
    shopifyProductId: "B0-ELEC-010",
  },
];

interface Props {
  onSuccess: () => void;
}

export default function AddProductDialog({ onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [products, setProducts] = useState<ProductRow[]>(DEFAULT_PRODUCTS);
  const [submitting, setSubmitting] = useState(false);

  // Single-product quick-create state
  const [singleSku, setSingleSku] = useState("");
  const [singleName, setSingleName] = useState("");
  const [singlePrice, setSinglePrice] = useState("");
  const [singleCategory, setSingleCategory] = useState("");
  const [singleVendor, setSingleVendor] = useState("");
  const [singleSubmitting, setSingleSubmitting] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [singleSuccess, setSingleSuccess] = useState(false);

  const { data: stores, isLoading: storesLoading } =
    trpc.products.stores.useQuery(undefined, { enabled: open });

  const createProduct = trpc.products.create.useMutation({
    onSuccess: () => {
      setSingleSuccess(true);
      setSingleError(null);
      setSingleSku("");
      setSingleName("");
      setSinglePrice("");
      setSingleCategory("");
      setSingleVendor("");
      // Reset success message after 3s
      setTimeout(() => setSingleSuccess(false), 3000);
      onSuccess();
    },
    onError: err => {
      setSingleError(err.message || "Failed to create product");
      setSingleSuccess(false);
    },
    onSettled: () => setSingleSubmitting(false),
  });

  const bulkSync = trpc.products.bulkSync.useMutation({
    onSuccess: () => {
      toast.success("10 electronics products added successfully");
      setOpen(false);
      onSuccess();
    },
    onError: err => {
      toast.error(err.message || "Failed to add products");
    },
    onSettled: () => setSubmitting(false),
  });

  const updateProduct = useCallback(
    (index: number, field: keyof ProductRow, value: string) => {
      setProducts(prev => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    []
  );

  const handleSingleSubmit = () => {
    setSingleError(null);
    setSingleSuccess(false);

    const trimmedName = singleName.trim();
    const trimmedSku = singleSku.trim().toUpperCase();
    const trimmedPrice = singlePrice.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setSingleError("Product name must be at least 2 characters");
      return;
    }
    if (!trimmedPrice || !/^\d+(\.\d{1,2})?$/.test(trimmedPrice)) {
      setSingleError(
        "Price must be a positive number with up to 2 decimal places"
      );
      return;
    }
    if (trimmedSku && !/^[A-Za-z0-9\-_/]+$/.test(trimmedSku)) {
      setSingleError("SKU can only contain letters, numbers, -, _ and /");
      return;
    }

    setSingleSubmitting(true);
    createProduct.mutate({
      storeId: storeId || undefined, // Backend will create "Manual" store if undefined
      title: trimmedName,
      sku: trimmedSku || undefined,
      price: trimmedPrice,
      category: singleCategory.trim() || undefined,
      vendor: singleVendor.trim() || undefined,
    });
  };

  const handleSubmit = () => {
    if (!storeId) {
      toast.error("Please select a store");
      return;
    }
    const invalid = products.findIndex(p => !p.title.trim() || !p.price.trim());
    if (invalid !== -1) {
      toast.error(`Row ${invalid + 1}: title and price are required`);
      return;
    }
    setSubmitting(true);
    bulkSync.mutate(
      products.map(p => ({
        storeId,
        title: p.title,
        sku: p.sku || undefined,
        price: p.price,
        category: p.category || undefined,
        vendor: p.vendor || undefined,
        shopifyProductId: p.shopifyProductId || undefined,
      }))
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <span className="mr-1.5 text-base leading-none">+</span>Add Products
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Electronics Products</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {/* ── Single-product quick-create ──────────────────────────────── */}
          <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low/50 p-4">
            <p className="text-sm font-medium">Quick Add Single Product</p>

            {singleError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {singleError}
              </div>
            )}
            {singleSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-500 bg-green-500/10 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Product created successfully!
              </div>
            )}

            <div className="space-y-3">
              <div className="flex gap-3 items-start">
                <div className="flex-1">
                  <Label
                    className="text-xs text-muted-foreground"
                    htmlFor="product-name"
                  >
                    Product Name *
                  </Label>
                  <Input
                    id="product-name"
                    name="product-name"
                    className="h-10"
                    value={singleName}
                    onChange={e => setSingleName(e.target.value)}
                    placeholder="e.g. Wireless Earbuds"
                    maxLength={255}
                  />
                </div>
                <div className="w-36 shrink-0">
                  <Label
                    className="text-xs text-muted-foreground"
                    htmlFor="product-price"
                  >
                    Price *
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none select-none">
                      $
                    </span>
                    <Input
                      id="product-price"
                      name="product-price"
                      className="h-10 pl-6 text-right font-mono"
                      value={singlePrice}
                      onChange={e => setSinglePrice(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="flex-1">
                  <Label
                    className="text-xs text-muted-foreground"
                    htmlFor="product-sku"
                  >
                    SKU
                  </Label>
                  <Input
                    id="product-sku"
                    name="product-sku"
                    className="h-10 font-mono"
                    value={singleSku}
                    onChange={e => setSingleSku(e.target.value)}
                    placeholder="e.g. ABC-123"
                    maxLength={100}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Optional. Recommended for accurate competitor matching.
                  </p>
                </div>
                <div className="flex-1">
                  <Label
                    className="text-xs text-muted-foreground"
                    htmlFor="product-category"
                  >
                    Category
                  </Label>
                  <Input
                    id="product-category"
                    name="product-category"
                    className="h-10"
                    value={singleCategory}
                    onChange={e => setSingleCategory(e.target.value)}
                    placeholder="e.g. Electronics"
                    maxLength={255}
                  />
                </div>
                <div className="flex-1">
                  <Label
                    className="text-xs text-muted-foreground"
                    htmlFor="product-vendor"
                  >
                    Vendor
                  </Label>
                  <Input
                    id="product-vendor"
                    name="product-vendor"
                    className="h-10"
                    value={singleVendor}
                    onChange={e => setSingleVendor(e.target.value)}
                    placeholder="e.g. SoundMax"
                    maxLength={255}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="h-10"
                  onClick={handleSingleSubmit}
                  disabled={singleSubmitting}
                >
                  {singleSubmitting ? "Adding..." : "Add"}
                </Button>
              </div>
            </div>
          </div>

          {/* ── Bulk add section ─────────────────────────────────────────── */}
          <p className="text-sm font-medium pt-2">Bulk Add (Spreadsheet)</p>

          {/* Store selector */}
          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium w-20 shrink-0">Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue
                  placeholder={
                    storesLoading ? "Loading stores..." : "Select a store"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map(
                  (s: {
                    id: string;
                    storeName: string | null;
                    shopDomain: string;
                  }) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.storeName || s.shopDomain}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Product table */}
          <div className="overflow-hidden rounded-xl border border-outline-variant/30">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-container-high">
                    <TableHead className="pl-4 w-8 label-caps text-muted-foreground font-normal">
                      #
                    </TableHead>
                    <TableHead className="label-caps text-muted-foreground font-normal">
                      Title
                    </TableHead>
                    <TableHead className="w-28 label-caps text-muted-foreground font-normal">
                      SKU
                    </TableHead>
                    <TableHead className="w-28 label-caps text-muted-foreground font-normal text-right">
                      Price
                    </TableHead>
                    <TableHead className="w-36 label-caps text-muted-foreground font-normal">
                      Category
                    </TableHead>
                    <TableHead className="w-32 label-caps text-muted-foreground font-normal">
                      Vendor
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-outline-variant/20">
                  {products.map((p, i) => (
                    <TableRow
                      key={i}
                      className="hover:bg-surface-container-low"
                    >
                      <td className="pl-4 py-2 text-xs text-muted-foreground font-mono">
                        {i + 1}
                      </td>
                      <td className="py-2">
                        <Input
                          name={`bulk-title-${i}`}
                          className="h-8 text-sm"
                          value={p.title}
                          onChange={e =>
                            updateProduct(i, "title", e.target.value)
                          }
                          placeholder="Product title"
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          name={`bulk-sku-${i}`}
                          className="h-8 text-sm font-mono"
                          value={p.sku}
                          onChange={e =>
                            updateProduct(i, "sku", e.target.value)
                          }
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          name={`bulk-price-${i}`}
                          className="h-8 text-sm font-mono text-right"
                          value={p.price}
                          onChange={e =>
                            updateProduct(i, "price", e.target.value)
                          }
                          placeholder="0.00"
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          name={`bulk-category-${i}`}
                          className="h-8 text-sm"
                          value={p.category}
                          onChange={e =>
                            updateProduct(i, "category", e.target.value)
                          }
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          name={`bulk-vendor-${i}`}
                          className="h-8 text-sm"
                          value={p.vendor}
                          onChange={e =>
                            updateProduct(i, "vendor", e.target.value)
                          }
                        />
                      </td>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !storeId}>
            {submitting ? "Adding..." : "Add 10 Products"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
