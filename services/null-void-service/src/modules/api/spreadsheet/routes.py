from flask import Blueprint, jsonify, request
import ast
from modules.session import session as sess
from .repository import SpreadsheetRepository

spreadsheet_bp = Blueprint('spreadsheet', __name__, url_prefix='/api/spreadsheet')

def _get_uid():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    return sess.get_user_id(token)

@spreadsheet_bp.route('', methods=['GET'])
def get_spreadsheet():
    uid = _get_uid()
    if not uid: 
        return jsonify(error='No autorizado'), 401
        
    data = SpreadsheetRepository.get_by_user(uid)
    return jsonify(data)

@spreadsheet_bp.route('', methods=['POST'])
def save_spreadsheet():
    uid = _get_uid()
    if not uid: 
        return jsonify(error='No autorizado'), 401

    data = request.get_json() or {}
    content = data.get('content', {})
    
    success = SpreadsheetRepository.save_or_update(uid, content)
    return jsonify(ok=success)


def _validate_sandbox_code(code: str) -> None:
    """Valida el código antes de ejecutarlo en el sandbox.

    Los builtins restringidos no bastan: la introspección de objetos
    (subclasses/globals) permite escapar del sandbox sin ningún builtin.
    Se analiza el AST y se rechaza:
      - cualquier atributo 'dunder' (__class__, __globals__, __subclasses__,
        __mro__, __init__, __builtins__, ...): todas las vías de escape
        conocidas pasan por introspección de dunders;
      - imports, definición de clases y sentencias global/nonlocal;
      - accesos a nombres de introspección (getattr, vars, globals, ...).
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f"Error de sintaxis: {e}")

    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            if node.attr.startswith('__'):
                raise ValueError(
                    "Operación no permitida: acceso a atributos internos (__x__) bloqueado")
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.ClassDef,
                             ast.Global, ast.Nonlocal)):
            raise ValueError("Operación no permitida: import/class/global bloqueados")
        if isinstance(node, ast.Name) and node.id in (
                'getattr', 'setattr', 'vars', 'globals', 'locals', 'dir',
                'eval', 'exec', 'compile', '__import__'):
            raise ValueError("Operación no permitida: introspección bloqueada")


@spreadsheet_bp.route('/run-python', methods=['POST'])
def run_python():
    token = request.cookies.get('token') or request.headers.get('X-Token')
    user = sess.get_user(token)
    if not user:
        return jsonify(error='No autorizado'), 401

    data = request.get_json() or {}
    code = data.get('code', '')
    spreadsheet_data = data.get('data', {})

    if len(code) > 5000:
        return jsonify(ok=False, error="Código demasiado largo (máx. 5000 caracteres)")

    try:
        _validate_sandbox_code(code)
    except ValueError as e:
        return jsonify(ok=False, error=str(e))

    try:
        import math
        import datetime

        safe_builtins = {
            'abs': abs, 'min': min, 'max': max, 'sum': sum, 'len': len,
            'str': str, 'int': int, 'float': float, 'bool': bool, 'list': list, 'dict': dict, 'round': round,
            'True': True, 'False': False, 'None': None, 'print': print
        }

        ctx = {
            'data': spreadsheet_data,
            'math': math,
            'datetime': datetime,
            'range': range,
            'set_cell': lambda cell, val: spreadsheet_data.update({str(cell): str(val)}),
            'get_cell': lambda cell: spreadsheet_data.get(str(cell), ''),
            'clear_all': lambda: spreadsheet_data.clear(),
        }

        exec(code, {"__builtins__": safe_builtins}, ctx)
        return jsonify(ok=True, data=spreadsheet_data)
    except Exception as e:
        return jsonify(ok=False, error=str(e))