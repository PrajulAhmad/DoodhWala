# 🎨 DoodhWala Design System (Field Utility System)

This document outlines the core visual theme, tokens, and components for the DoodhWala mobile application as defined in the Google Stitch design system project.

---

## 🌟 Brand & Style Guidelines

The design system is engineered for **utility and resilience**. It caters to an audience performing physical labor in variable outdoor lighting—specifically the harsh transition from pre-dawn to direct early morning sunlight. 

The aesthetic is **Modern Corporate/Utility**, heavily influenced by Material 3 but stripped of decorative flourishes to prioritize legibility and rapid task completion. The emotional response is one of **reliability and efficiency**. Every interface element is designed to be perceived and interacted with through a "glance and tap" mental model, minimizing cognitive load during a busy delivery route.

---

## 🎨 Color Palette & Contrast

Optimized for high-contrast visibility in bright outdoor light:

| Token | Hex Value | Purpose |
| :--- | :--- | :--- |
| `primary` | `#0D631B` | Primary actions and brand indicators |
| `primary-container` | `#2E7D32` | Secondary green surfaces |
| `on-primary` | `#FFFFFF` | Text/icons on primary backgrounds |
| `surface` | `#F7FAFC` | Main background color (cool light-gray, reduces glare) |
| `surface-container-lowest` | `#FFFFFF` | Card background (pure white, stands out from surface) |
| `surface-container-low` | `#F1F4F6` | Secondary panel backgrounds |
| `on-surface` | `#181C1E` | Primary body text (contrast ratio > 7:1) |
| `on-surface-variant` | `#40493D` | Secondary labels and descriptions |
| `error` | `#BA1A1A` | Overdue balances, error banners, and warnings |
| `error-container` | `#FFDAD6` | Background for error cards |
| `outline` | `#707A6C` | Standard borders |
| `outline-variant` | `#BFCABA` | Subdued dividers and borders |

---

## 🅰️ Typography

We utilize **Inter** as the single font family for its tall x-height and excellent legibility at medium sizes.

* **Size/Weight Mandate:** No font size falls below `14px`. Weight is preferred over size; thus, even small labels use a Medium (500) weight to prevent fading in bright light.
* **Tokens Scale:**

```css
/* Display Title */
font-size: 24px;
font-weight: 700;
line-height: 32px;
letter-spacing: -0.01em;

/* Customer Name */
font-size: 20px;
font-weight: 700;
line-height: 28px;

/* Body MD */
font-size: 16px;
font-weight: 400;
line-height: 24px;

/* Label SM */
font-size: 14px;
font-weight: 500;
line-height: 20px;
letter-spacing: 0.02em;

/* Button Text */
font-size: 16px;
font-weight: 600;
line-height: 20px;
letter-spacing: 0.01em;
```

---

## 📏 Layout & Spacing

* **The 60% Rule:** All critical interactive elements (quantity pickers, "Mark Delivered" buttons, shift toggles) must reside in the lower 60% of the screen for single-handed thumb operation.
* **Touch Targets:** A strict **48px minimum** is enforced for all interactive areas to account for outdoor usage where users may have wet hands or be in motion.
* **Margins:** Consistent **16px lateral padding** (gutter) prevents content from feeling cramped on narrower Android devices.

---

## 🛡️ Depth, Elevation & Shapes

* **Tonal Layers:** The design system uses background contrast and borders rather than drop shadows to create structure:
  * **Surface Level 0 (Base):** `#F7FAFC`
  * **Surface Level 1 (Cards):** `#FFFFFF` with a `1px` border `#E2E8F0` (provides a crisp edge in sunlight).
  * **Active Press State:** A slight tonal shift (primary color at `8%` opacity) rather than a shadow elevation.
* **Corner Roundness:**
  * Interactive elements (Buttons, Inputs): `8px` (`0.5rem`) corner radius.
  * Status Indicators (Morning/Evening shifts, Vacation badges): Pill-shaped (`9999px`) to distinguish from functional buttons.
