import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type CartRow = {
  quantity: number;
  products: { id: string; name: string; price: number } | null;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const recipient_name = String(body.recipient_name || "").trim();
  const address_line = String(body.address_line || "").trim();
  const phone = String(body.phone || "").trim();

  if (!recipient_name || !address_line || !phone) {
    return NextResponse.json(
      { error: "받는 분, 주소, 연락처를 입력하세요." },
      { status: 400 }
    );
  }

  const { data: cartRows, error: cartError } = await supabase
    .from("cart_items")
    .select("quantity, products(id, name, price)")
    .eq("user_id", user.id);

  if (cartError) {
    return NextResponse.json({ error: cartError.message }, { status: 500 });
  }

  const rows = (cartRows || []) as CartRow[];
  const valid = rows.filter((r) => r.products);
  if (valid.length === 0) {
    return NextResponse.json(
      { error: "장바구니가 비어 있습니다." },
      { status: 400 }
    );
  }

  const { data: stockRows, error: stockErr } = await supabase
    .from("products")
    .select("id, stock")
    .in(
      "id",
      valid.map((r) => r.products!.id)
    );

  if (stockErr) {
    return NextResponse.json({ error: stockErr.message }, { status: 500 });
  }

  const stockMap = new Map(
    (stockRows || []).map((s: { id: string; stock: number }) => [s.id, s.stock])
  );

  for (const r of valid) {
    const pid = r.products!.id;
    const available = stockMap.get(pid);
    if (available === undefined) {
      return NextResponse.json(
        { error: "상품 정보를 확인할 수 없습니다." },
        { status: 400 }
      );
    }
    if (r.quantity > available) {
      return NextResponse.json(
        {
          error: `재고가 부족합니다: ${r.products!.name} (남은 수량 ${available}개)`,
        },
        { status: 400 }
      );
    }
  }

  let total = 0;
  for (const r of valid) {
    total += r.products!.price * r.quantity;
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: user.id,
      total_amount: total,
      status: "pending",
      recipient_name,
      address_line,
      phone,
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    return NextResponse.json(
      { error: orderErr?.message || "주문 생성 실패" },
      { status: 500 }
    );
  }

  const orderId = order.id as string;

  const itemPayload = valid.map((r) => ({
    order_id: orderId,
    product_id: r.products!.id,
    quantity: r.quantity,
    unit_price: r.products!.price,
  }));

  const { error: itemsErr } = await supabase.from("order_items").insert(itemPayload);

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  }

  return NextResponse.json({
    orderId,
    amount: total,
    orderName: "Shop Real 주문",
  });
}
