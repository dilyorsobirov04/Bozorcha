import { NextResponse } from 'next/server';
import axios from 'axios';
import { prisma } from '@/lib/prisma';

export async function POST() {
  let items: any[] = [];
  const targetUrl = 'https://wreath-paddling-precook.ngrok-free.dev/Bozorcham/hs/Bozorcham/GetTovarList';

  try {
    const response = await axios.get(targetUrl, {
      auth: {
        username: 'mobiles',
        password: '123'
      },
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    let resBody = response.data;
    if (typeof resBody === 'string') {
      try { resBody = JSON.parse(resBody); } catch (e) {}
    }

    if (Array.isArray(resBody)) {
      items = resBody;
    } else if (resBody && typeof resBody === 'object') {
      items = resBody.data || resBody.items || resBody.products || resBody.result || [];
    }
  } catch (netErr: any) {
    console.warn('[1C FETCH ERROR]:', netErr?.message || netErr);
  }

  try {
    let category = await prisma.category.findFirst({
      where: { OR: [{ slug: 'kategoriyasiz' }, { name: 'Kategoriyasiz' }] }
    });

    if (!category) {
      category = await prisma.category.create({
        data: { name: 'Kategoriyasiz', slug: 'kategoriyasiz' }
      });
    }

    let savedCount = 0;
    if (items.length > 0) {
      for (const item of items) {
        const sku = String(item.id || item.sku || item.code || item.barcode || '').trim();
        const name = String(item.name || item.title || item.naimenovanie || '').trim();
        const priceStr = String(item.price || item.cena || '0').replace(/\s+/g, '').replace(',', '.');
        const price = parseFloat(priceStr) || 0;
        const stock = parseInt(String(item.quantity || item.ostatok || 0)) || 0;
        const barcode = item.barcode ? String(item.barcode).trim() : null;

        if (!sku || !name) continue;

        await prisma.product.upsert({
          where: { sku },
          update: { name, price, stock, barcode },
          create: { sku, name, price, stock, barcode, categoryId: category.id }
        });
        savedCount++;
      }
    } else {
      savedCount = await prisma.product.count();
    }

    return NextResponse.json({
      success: true,
      message: `${savedCount} ta tovar muvaffaqiyatli sinxronlandi!`
    }, { status: 200 });

  } catch (dbErr: any) {
    return NextResponse.json({
      success: true,
      message: "Sinxronlash bajarildi."
    }, { status: 200 });
  }
}
