import { jsPDF } from 'jspdf';
import { dbService } from './db';

export const pdfService = {
  async generateInvoicePDF(invoiceId) {
    if (!dbService.initialized) {
      throw new Error("Database not initialized.");
    }

    // 1. Fetch Invoice details
    const invRes = await dbService.query("SELECT * FROM Invoice WHERE invoice_id = ? LIMIT 1;", [invoiceId]);
    if (!invRes.values || invRes.values.length === 0) throw new Error("Invoice not found.");
    const invoice = invRes.values[0];

    // 2. Fetch Customer details
    const customer = await dbService.getCustomerDetails(invoice.customer_id);
    if (!customer) throw new Error("Customer not found.");

    // 3. Fetch Line Items
    const linesRes = await dbService.query(
      "SELECT * FROM InvoiceLineItem WHERE invoice_id = ? ORDER BY delivery_date ASC, delivery_shift ASC;",
      [invoiceId]
    );
    const lineItems = linesRes.values || [];

    // 4. Fetch Business Profile
    const profRes = await dbService.query("SELECT * FROM BusinessProfile LIMIT 1;");
    let profile = {
      business_name: "Krishna Dairy",
      milkman_name: "Ramesh Sharma",
      phone_number: "+91 98765 43210",
      upi_id: "kdairy@okaxis",
      address: "Sector 4, Dwarka, Delhi"
    };
    if (profRes.values && profRes.values.length > 0) {
      profile = profRes.values[0];
    }

    // 5. Initialize jsPDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Color Palette
    const primaryColor = [16, 185, 129]; // Emerald green
    const textColor = [31, 41, 55]; // Charcoal
    const lightGray = [243, 244, 246];

    // Fonts
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);

    // Page Width and margins
    const pageWidth = doc.internal.pageSize.width; // 210mm
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);

    let y = 20;

    // Header - Business Identity
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(profile.business_name || profile.milkman_name, margin, y);
    
    // Invoice Metadata
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128); // Muted gray
    const metaX = pageWidth - margin;
    
    doc.text(`Invoice: ${invoice.invoice_number}`, metaX, y, { align: 'right' });
    y += 6;
    doc.text(`Date: ${new Date(invoice.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, metaX, y, { align: 'right' });
    y += 6;
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const periodStr = `${monthNames[invoice.billing_month - 1]} ${invoice.billing_year}`;
    doc.text(`Period: ${periodStr}`, metaX, y, { align: 'right' });
    y += 2;

    // Left info
    doc.setFontSize(10);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(`Milkman: ${profile.milkman_name}`, margin, y - 6);
    doc.text(`Phone: ${profile.phone_number}`, margin, y);
    y += 12;

    // Line separator
    doc.setDrawColor(229, 231, 235);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // Bill To Section
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text("Bill To:", margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(customer.name, margin, y);
    y += 5;
    doc.text(customer.phone_number, margin, y);
    if (customer.address) {
      y += 5;
      doc.text(customer.address, margin, y);
    }
    y += 12;

    // Table Header
    doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
    doc.rect(margin, y, contentWidth, 8, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text("Date", margin + 2, y + 5.5);
    doc.text("Shift", margin + 25, y + 5.5);
    doc.text("Product", margin + 50, y + 5.5);
    doc.text("Qty", margin + 95, y + 5.5);
    doc.text("Rate", margin + 120, y + 5.5);
    doc.text("Total", pageWidth - margin - 2, y + 5.5, { align: 'right' });
    y += 8;

    // Table Rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    
    lineItems.forEach((item, index) => {
      // Page break check
      if (y > 250) {
        doc.addPage();
        y = 20;
        // Reprint header row
        doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
        doc.rect(margin, y, contentWidth, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.text("Date", margin + 2, y + 5.5);
        doc.text("Shift", margin + 25, y + 5.5);
        doc.text("Product", margin + 50, y + 5.5);
        doc.text("Qty", margin + 95, y + 5.5);
        doc.text("Rate", margin + 120, y + 5.5);
        doc.text("Total", pageWidth - margin - 2, y + 5.5, { align: 'right' });
        y += 8;
        doc.setFont('helvetica', 'normal');
      }

      // Alternate row backgrounds
      if (index % 2 === 1) {
        doc.setFillColor(250, 250, 250);
        doc.rect(margin, y, contentWidth, 7, 'F');
      }

      const dateStr = new Date(item.delivery_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      doc.text(dateStr, margin + 2, y + 5);
      doc.text(item.delivery_shift === 0 ? "Morning" : "Evening", margin + 25, y + 5);
      doc.text(item.product_display_name_snapshot, margin + 50, y + 5);
      doc.text(`${item.quantity.toFixed(2)}L`, margin + 95, y + 5);
      doc.text(`Rs ${(item.rate_applied / 100).toFixed(2)}`, margin + 120, y + 5);
      
      const rowSubtotal = (item.line_subtotal / 100).toFixed(2);
      doc.text(`Rs ${rowSubtotal}`, pageWidth - margin - 2, y + 5, { align: 'right' });
      y += 7;
    });

    y += 5;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    // Summaries
    const summaryX = pageWidth - margin - 50;
    const valueX = pageWidth - margin - 2;
    
    doc.text("Previous Outstanding:", summaryX, y);
    doc.text(`Rs ${(invoice.previous_outstanding / 100).toFixed(2)}`, valueX, y, { align: 'right' });
    y += 6;
    
    doc.text("Current Month Charges:", summaryX, y);
    doc.text(`Rs ${(invoice.current_month_total / 100).toFixed(2)}`, valueX, y, { align: 'right' });
    y += 6;
    
    doc.text("Payments Received:", summaryX, y);
    doc.text(`Rs -${(invoice.payments_received / 100).toFixed(2)}`, valueX, y, { align: 'right' });
    y += 6;

    if (invoice.net_adjustments !== 0) {
      doc.text("Net Adjustments:", summaryX, y);
      const adjVal = invoice.net_adjustments;
      doc.text(`Rs ${adjVal < 0 ? '-' : ''}${Math.abs(adjVal / 100).toFixed(2)}`, valueX, y, { align: 'right' });
      y += 6;
    }

    doc.line(summaryX, y - 2, pageWidth - margin, y - 2);

    doc.setFont('helvetica', 'bold');
    doc.text("TOTAL AMOUNT DUE:", summaryX, y + 2);
    doc.text(`Rs ${(invoice.grand_total / 100).toFixed(2)}`, valueX, y + 2, { align: 'right' });
    y += 15;

    // Pay instantly via UPI Block
    if (y > 230) {
      doc.addPage();
      y = 20;
    }

    doc.setFillColor(243, 244, 246);
    doc.rect(margin, y, contentWidth, 25, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text("Pay Instantly Via UPI:", margin + 5, y + 7);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`UPI ID: ${profile.upi_id}`, margin + 5, y + 13);
    
    // Construct UPI Deep Link
    const upiLink = `upi://pay?pa=${profile.upi_id}&am=${(invoice.grand_total / 100).toFixed(2)}&tn=Milk+Bill+${periodStr.replace(' ', '')}`;
    doc.setFontSize(8);
    doc.setTextColor(107, 114, 128);
    doc.text(`Link: ${upiLink}`, margin + 5, y + 19);

    y += 35;

    // Footer Thank you note
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text("Thank you for your continued trust. — DoodhWala", pageWidth / 2, y, { align: 'center' });

    // Output Base64 String
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    return pdfBase64;
  }
};
