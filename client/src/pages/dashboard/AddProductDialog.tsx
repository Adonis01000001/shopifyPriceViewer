import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface ProductRow {
  title: string;
  sku: string;
  price: string;
  category: string;
  vendor: string;
  shopifyProductId: string;
}

const DEFAULT_PRODUCTS: ProductRow[] = [
  { title: "Wireless Bluetooth Earbuds", sku: "ELEC-001", price: "49.99", category: "Electronics", vendor: "SoundMax", shopifyProductId: "B0-ELEC-001" },
  { title: "USB-C Hub 7-in-1", sku: "ELEC-002", price: "34.99", category: "Electronics", vendor: "ConnectPro", shopifyProductId: "B0-ELEC-002" },
  { title: "Mechanical Keyboard RGB", sku: "ELEC-003", price: "89.99", category: "Electronics", vendor: "KeyMaster", shopifyProductId: "B0-ELEC-003" },
  { title: "27\" 4K IPS Monitor", sku: "ELEC-004", price: "299.99", category: "Electronics", vendor: "ViewSharp", shopifyProductId: "B0-ELEC-004" },
  { title: "Ergonomic Wireless Mouse", sku: "ELEC-005", price: "45.99", category: "Electronics", vendor: "ClickEase", shopifyProductId: "B0-ELEC-005" },
  { title: "10000mAh Power Bank", sku: "ELEC-006", price: "29.99", category: "Electronics", vendor: "ChargeUp", shopifyProductId: "B0-ELEC-006" },
  { title: "Smart WiFi LED Bulb 4-Pack", sku: "ELEC-007", price: "24.99", category: "Electronics", vendor: "BrightHome", shopifyProductId: "B0-ELEC-007" },
  { title: "Noise Cancelling Headphones", sku: "ELEC-008", price: "149.99", category: "Electronics", vendor: "SoundCore", shopifyProductId: "B0-ELEC-008" },
  { title: "Portable SSD 1TB", sku: "ELEC-009", price: "79.99", category: "Electronics", vendor: "DataSpeed", shopifyProductId: "B0-ELEC-009" },
  { title: "Webcam 1080p HD", sku: "ELEC-010", price: "59.99", category: "Electronics", vendor: "ClearView", shopifyProductId: "B0-ELEC-010" },
];

interface Props {
  onSuccess: () => void;
}

export default function AddProductDialog({ onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [products, setProducts] = useState<ProductRow[]>(DEFAULT_PRODUCTS);
  const [submitting, setSubmitting] = useState(false);

  const { data: stores, isLoading: storesLoading } = trpc.products.stores.useQuery(undefined, { enabled: open });

  const bulkSync = trpc.products.bulkSync.useMutation({
    onSuccess: () => {
      toast.success("10 electronics products added successfully");
      setOpen(false);
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add products");
    },
    onSettled: () => setSubmitting(false),
  });

  const updateProduct = useCallback((index: number, field: keyof ProductRow, value: string) => {
    setProducts(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

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
    bulkSync.mutate(products.map(p => ({
      storeId,
      title: p.title,
      sku: p.sku || undefined,
      price: p.price,
      category: p.category || undefined,
      vendor: p.vendor || undefined,
      shopifyProductId: p.shopifyProductId || undefined,
    })));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9 bg-primary text-primary-foreground hover:bg-primary/90">
          <span className="mr-1.5 text-base leading-none">+</span>Add Products
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Electronics Products</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {/* Store selector */}
          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium w-20 shrink-0">Store</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-full h-9">
                <SelectValue placeholder={storesLoading ? "Loading stores..." : "Select a store"} />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.storeName || s.shopDomain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Product table */}
          <div className="border border-outline-variant/30 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-container-high">
                    <TableHead className="pl-4 w-8 label-caps text-muted-foreground font-normal">#</TableHead>
                    <TableHead className="label-caps text-muted-foreground font-normal">Title</TableHead>
                    <TableHead className="w-28 label-caps text-muted-foreground font-normal">SKU</TableHead>
                    <TableHead className="w-28 label-caps text-muted-foreground font-normal text-right">Price</TableHead>
                    <TableHead className="w-36 label-caps text-muted-foreground font-normal">Category</TableHead>
                    <TableHead className="w-32 label-caps text-muted-foreground font-normal">Vendor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-outline-variant/20">
                  {products.map((p, i) => (
                    <TableRow key={i} className="hover:bg-white/[0.02]">
                      <td className="pl-4 py-2 text-xs text-muted-foreground font-mono">{i + 1}</td>
                      <td className="py-2">
                        <Input
                          className="h-8 text-sm"
                          value={p.title}
                          onChange={e => updateProduct(i, "title", e.target.value)}
                          placeholder="Product title"
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          className="h-8 text-sm font-mono"
                          value={p.sku}
                          onChange={e => updateProduct(i, "sku", e.target.value)}
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          className="h-8 text-sm font-mono text-right"
                          value={p.price}
                          onChange={e => updateProduct(i, "price", e.target.value)}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          className="h-8 text-sm"
                          value={p.category}
                          onChange={e => updateProduct(i, "category", e.target.value)}
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          className="h-8 text-sm"
                          value={p.vendor}
                          onChange={e => updateProduct(i, "vendor", e.target.value)}
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
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
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
