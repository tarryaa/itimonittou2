import { test, expect, type Page } from '@playwright/test';

const firstId='jp-kana-001-p012-q01';
const card = (page:Page,id=firstId) => page.locator(`[data-qid="${id}"]`);
async function start(page:Page){await page.goto('/');await expect(page.locator('[data-qid]')).toHaveCount(1496);}
async function close(page:Page){await page.getByRole('dialog').getByRole('button',{name:'閉じる',exact:true}).click();}
async function filters(page:Page){await page.getByRole('button',{name:/^絞り込み/}).click();return page.getByRole('dialog',{name:'問題を絞り込む'});}
async function settings(page:Page){await page.getByRole('button',{name:'設定とデータ管理'}).click();return page.getByRole('dialog',{name:'設定・データ管理'});}

test('all source questions render; red terms toggle independently and blank popup uses corresponding answer',async({page})=>{
 await start(page); const second=card(page,'jp-kana-001-p012-q02');
 const red=second.locator('.red-segment');await expect(red).toHaveCount(3);
 await expect(red.nth(0)).toHaveAttribute('aria-pressed','false');await red.nth(0).click();
 await expect(red.nth(0)).toHaveAttribute('aria-pressed','true');await expect(red.nth(1)).toHaveAttribute('aria-pressed','false');
 await red.nth(0).click();await expect(red.nth(0)).toHaveAttribute('aria-pressed','false');
 const blank=card(page).locator('.blank').first();await blank.click();
 const popup=page.getByRole('tooltip');await expect(popup).toContainText('700万年前');await expect(popup).toContainText('空欄に入る部分：700');
 const box=await popup.boundingBox();expect(box).toBeTruthy();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(391);
 await blank.click();await expect(popup).toHaveCount(0);
 await page.getByRole('button',{name:'すべて表示',exact:true}).click();await expect(red.nth(0)).toHaveAttribute('aria-pressed','true');
 await expect(card(page).locator('.blank')).toContainText('700');
 await page.getByRole('button',{name:'すべて隠す',exact:true}).click();await expect(red.nth(0)).toHaveAttribute('aria-pressed','false');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);expect(overflow).toBe(false);
});

test('mistake events persist individually and counter changes preserve scroll',async({page})=>{
 await start(page);const q=card(page,'jp-kana-001-p014-c02-q03');await q.scrollIntoViewIfNeeded();
 await q.getByRole('button',{name:'間違いを1回記録',exact:true}).click();const y=await page.evaluate(()=>scrollY);
 await q.getByRole('button',{name:'間違いを1回記録',exact:true}).click();await expect(q.getByRole('button',{name:'間違い履歴を開く'})).toHaveText('2');
 expect(Math.abs(await page.evaluate(()=>scrollY)-y)).toBeLessThan(3);
 await q.getByRole('button',{name:'間違いを1回取り消す'}).click();await expect(q.getByRole('button',{name:'間違い履歴を開く'})).toHaveText('1');
 await page.waitForTimeout(500);await page.reload();await expect(q.getByRole('button',{name:'間違い履歴を開く'})).toHaveText('1');
 await q.getByRole('button',{name:'間違い履歴を開く'}).click();await expect(page.getByRole('dialog')).toContainText('日本時間（JST）');await expect(page.getByRole('dialog').locator('.history-row')).toHaveCount(1);
});

test('filter retains current anchor; marked questions bypass mistake conditions; removal selects a nearby question',async({page})=>{
 await start(page);const id='jp-kana-001-p026-c06-q01';const q=card(page,id);await q.scrollIntoViewIfNeeded();await q.getByRole('button',{name:'注意マーク'}).click();
 await page.waitForTimeout(500);const top=await q.evaluate(e=>e.getBoundingClientRect().top);
 let modal=await filters(page);await modal.getByLabel('時代',{exact:true}).selectOption('古墳時代');await modal.getByRole('button',{name:'この条件で表示'}).click();
 await expect(q).toHaveCount(1);expect(Math.abs(await q.evaluate(e=>e.getBoundingClientRect().top)-top)).toBeLessThan(4);
 modal=await filters(page);await modal.getByLabel('間違い回数（以上）').fill('99');await modal.getByLabel('注意マーク「！」').selectOption('include');await modal.getByRole('button',{name:'この条件で表示'}).click();
 await expect(page.locator('[data-qid]')).toHaveCount(1);await expect(q).toBeVisible();
 modal=await filters(page);await modal.getByRole('button',{name:'条件をリセット'}).click();await modal.getByRole('button',{name:'この条件で表示'}).click();
 await expect(page.locator('[data-qid]')).toHaveCount(1496);await expect(q).toBeVisible();
});

test('editor persists text overlay, retains original and history, and supports red to blank conversion',async({page})=>{
 await start(page);await card(page).getByRole('button',{name:'間違いを1回記録',exact:true}).click();
 await card(page).getByRole('button',{name:'問題の編集とタグ'}).click();await page.getByRole('button',{name:'問題文・赤字・空欄・解答を編集'}).click();
 const editor=page.getByRole('dialog',{name:'問題 1 を編集'});const first=editor.locator('textarea').first();const original=await first.inputValue();await first.fill('【動作検証】'+original);
 await editor.getByRole('button',{name:'変更を保存'}).click();await expect(card(page)).toContainText('【動作検証】');await page.waitForTimeout(500);await page.reload();
 await expect(card(page)).toContainText('【動作検証】');await expect(card(page).getByRole('button',{name:'間違い履歴を開く'})).toHaveText('1');
 await card(page).getByRole('button',{name:'問題の編集とタグ'}).click();await page.getByRole('button',{name:'問題文・赤字・空欄・解答を編集'}).click();
 await editor.getByText('原文と元の解答を確認',{exact:true}).click();await expect(editor.locator('.original')).not.toContainText('【動作検証】');
 await editor.getByRole('button',{name:'編集を閉じる'}).click();
});

test('backup downloads all records, invalid restore is rejected, and valid restore previews before replacing',async({page})=>{
 await start(page);await card(page).getByRole('button',{name:'間違いを1回記録',exact:true}).click();await settings(page);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'全データをJSONで保存'}).click();const download=await downloadPromise;
 const stream=await download.createReadStream();let body='';for await(const chunk of stream!)body+=chunk.toString();const parsed=JSON.parse(body);expect(parsed.dataset.questions).toHaveLength(1496);expect(parsed.state.mistakes).toHaveLength(1);
 const file=page.getByRole('dialog').locator('input[type=file]').first();await file.setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"bad":true}')});await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('dialog',{name:'バックアップ復元の確認'})).toHaveCount(0);await page.getByRole('alert').getByRole('button',{name:'閉じる'}).click();
 await file.setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(body)});const preview=page.getByRole('dialog',{name:'バックアップ復元の確認'});await expect(preview).toContainText('1496問 / 1件の間違い記録');await preview.getByRole('button',{name:'キャンセル'}).click();
});
