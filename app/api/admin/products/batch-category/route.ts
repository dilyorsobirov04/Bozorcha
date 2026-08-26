import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const { productIds, categoryId } = await req.json();

    if (!categoryId || !Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: "Kategoriya va kamida bitta tovar tanlanishi shart!"
      }, { status: 400 });
    }

    // Mass Update Products
    const updated = await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: { categoryId: Number(categoryId) }
    });

    return NextResponse.json({
      success: true,
      message: `${updated.count} ta tovar kategoriyaga biriktirildi!`
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      message: error.message
    }, { status: 500 });
  }
}
