from .scraper_db import get_all_products, get_product_history, get_user_tasks as db_get_user_tasks, add_user_task as db_add_user_task, delete_user_task as db_delete_user_task, get_user_config as db_get_user_config, set_user_config as db_set_user_config, get_product_detail as db_get_product_detail, save_product_detail as db_save_product_detail, mark_product_sold_out as db_mark_product_sold_out, mark_product_in_stock as db_mark_product_in_stock

def get_scraped_data(user_id=None, scraper_type=None):
    return get_all_products(user_id, scraper_type)

def get_product_history_data(sku):
    return get_product_history(sku)

def get_user_tasks(user_id):
    return db_get_user_tasks(user_id)

def add_user_task(user_id, query):
    return db_add_user_task(user_id, query)

def delete_user_task(user_id, task_id):
    return db_delete_user_task(user_id, task_id)

def get_user_config(user_id):
    return db_get_user_config(user_id)

def set_user_config(user_id, scraper_ref=None, filters=None):
    return db_set_user_config(user_id, scraper_ref=scraper_ref, filters=filters)

def get_product_detail(sku):
    return db_get_product_detail(sku)

def save_product_detail(sku, description, images, contact):
    return db_save_product_detail(sku, description, images, contact)

def mark_product_sold_out(sku):
    return db_mark_product_sold_out(sku)

def mark_product_in_stock(sku):
    return db_mark_product_in_stock(sku)
