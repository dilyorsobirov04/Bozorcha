import { NextResponse } from 'next/server';
import axios from 'axios';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  let items: any[] = [];
  let debugError = '';

  // Get URL from DB setting if available, or fallback
  let targetUrl = 'https://wreath-paddling-precook.ngrok-free.dev/Bozorcham/hs/Bozorcham/GetTovarList';
  
  try {
    const body = await req.json().catch(() => ({}));
    if (body.url) {
      targetUrl = body.url;
    } else {
      const setting = await prisma.systemSetting?.findUnique({ where: { key: '1C_HTTP_URL' } }).catch(() => null);
      if (setting?.value) targetUrl = setting.value;
    }
  } catch (e) {}

  // Basic Auth Base64
  const authHeader = 'Basic ' + Buffer.from('mobiles:123').toString('base64');

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'Authorization': authHeader,
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
    debugError = netErr?.response?.data 
      ? JSON.stringify(netErr.response.data) 
      : (netErr?.message || 'Network Timeout');
    console.error('[1C FETCH FAILURE]:', debugError);
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
      message: items.length > 0 
        ? `${savedCount} ta tovar 1C dan yuklandi!` 
        : `Sinxronlash bajarildi (Natija bo'sh: ${debugError || 'Tovar topilmadi'})`
    });

  } catch (dbErr: any) {
    return NextResponse.json({
      success: false,
      message: "Baza bilan ishlashda xatolik yuz berdi"
    }, { status: 500 });
  }
}
